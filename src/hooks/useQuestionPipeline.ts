/**
 * Interviewer question assembler, gap timers, and filler logic (перебивки).
 *
 * Responsibility:
 * - Accumulates fragmented VAD transcription segments into single coherent questions.
 * - Handles flush timers on pauses/silence gaps.
 * - Manages active Russian filler state ("Да, секундочку..." / перебивки): one
 *   stable phrase per pending answer, cleared when the response starts streaming.
 * - Provides reset and question-assembler coordination.
 */
import { useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  QuestionAssembler,
  ACTIVE_ASR_MODE,
  ASR_TIMING_PRESETS,
} from "@/lib/question-assembler";
import { selectFillerForText } from "@/lib/transcript-stabilizer";
import { setUnthrottledTimeout } from "@/lib/timer-worker";
import { safeLocalStorage } from "@/lib/storage/helper";
import { STORAGE_KEYS } from "@/config/constants";
import { AI_PROVIDERS } from "@/config/ai-providers.constants";
import { deepVariableReplacer } from "@/lib/functions/common.function";
import { LiveSegment } from "./useConversationStore";

function resolveActiveProviderUrl(): string | null {
  try {
    const rawSelected = safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_AI_PROVIDER);
    const selected = rawSelected
      ? (JSON.parse(rawSelected) as { provider?: string; variables?: Record<string, string> })
      : null;
    const providerId = selected?.provider || "openai";

    let curlTemplate = AI_PROVIDERS.find((p) => p.id === providerId)?.curl;
    if (!curlTemplate) {
      const rawCustom = safeLocalStorage.getItem(STORAGE_KEYS.CUSTOM_AI_PROVIDERS);
      if (rawCustom) {
        const customProviders = JSON.parse(rawCustom) as Array<{ id: string; curl?: string }>;
        curlTemplate = customProviders.find((p) => p.id === providerId)?.curl;
      }
    }
    if (!curlTemplate) return null;

    const resolvedCurl: string = selected?.variables
      ? String(deepVariableReplacer(curlTemplate, selected.variables))
      : curlTemplate;

    const match =
      resolvedCurl.match(/(?:--url\s+|--location\s+|curl\s+|['"]https?:\/\/)(['"]?)(https?:\/\/[^\s'"]+)\1/i) ||
      resolvedCurl.match(/https?:\/\/[^\s'"]+/i);
    return match ? match[2] || match[0] : null;
  } catch {
    return null;
  }
}
export interface UseQuestionPipelineProps {
  onTriggerAI: (question: string, source: "me" | "them") => Promise<void>;
  liveSegmentsRef: React.MutableRefObject<LiveSegment[]>;
}

export function useQuestionPipeline({
  onTriggerAI,
  liveSegmentsRef,
}: UseQuestionPipelineProps) {
  const [activeFiller, setActiveFiller] = useState<string | null>(null);
  const [pendingUtteranceId, setPendingUtteranceId] = useState<string | null>(
    null
  );
  const activeAskUtteranceIdRef = useRef<string | null>(null);

  const questionAssemblerRef = useRef<QuestionAssembler | null>(null);
  /** Cancels the pending gap timer. The timer itself lives in a Worker. */
  const cancelGapTimerRef = useRef<(() => void) | null>(null);
  const asrTimingConfig = ASR_TIMING_PRESETS[ACTIVE_ASR_MODE];
  const activeProviderUrlRef = useRef<string | null>(null);


  if (!questionAssemblerRef.current) {
    questionAssemblerRef.current = new QuestionAssembler({
      mode: ACTIVE_ASR_MODE,
    });
  }


  const clearFiller = useCallback(() => {
    setActiveFiller(null);
    setPendingUtteranceId(null);
    activeAskUtteranceIdRef.current = null;
  }, []);

  const setFillerForAnchor = useCallback(
    (anchorId: string | null = null, questionText = "") => {
      // One filler phrase per answer: pick once, keep stable until cleared.
      // No rotation interval — the phrase must not change while the user
      // is reading it aloud mid-sentence.
      //
      // The phrase is spoken by the candidate, so it must be in the language of
      // the QUESTION: an English question answered with a Russian opener reads
      // as a script, and the reverse does too.
      const filler = selectFillerForText(questionText);
      setActiveFiller(filler);
      setPendingUtteranceId(anchorId);
      activeAskUtteranceIdRef.current = anchorId || "auto";
    },
    []
  );

  const setFillerForInterviewer = useCallback(
    (questionText = "") => {
      // Immediate display on dispatch: unbind from anchorId.
      // In case anchor exists in liveSegmentsRef, keep it for back-compat,
      // but filler is shown regardless (anchorId can be null or anchor.id).
      const anchor =
        [...liveSegmentsRef.current].reverse().find((s) => s.source === "them") ||
        null;
      setFillerForAnchor(anchor ? anchor.id : null, questionText);
    },
    [liveSegmentsRef, setFillerForAnchor]
  );

  const resetQuestionAssembly = useCallback(() => {
    questionAssemblerRef.current?.reset();
    cancelGapTimerRef.current?.();
    cancelGapTimerRef.current = null;
  }, []);

  const handleInterviewerTranscription = useCallback(
    async (transcription: string, pauseBeforeMs?: number) => {
      const assembler = questionAssemblerRef.current!;
      const result = assembler.push({
        source: "them",
        text: transcription,
        timestamp: Date.now(),
        // Real silence from the audio when the capture layer measured it; the
        // arrival interval is not a pause (recognition lags by ~1.1s).
        pauseBeforeMs,
      });

      if (result.kind === "discarded") {
        console.log(
          `[Echo AI] Question fragment discarded (${result.reason}): "${transcription}"`
        );
        return;
      }

      // (Re)arm the gap timer: if the interviewer goes quiet, emit the
      // accumulated question and let the AI answer it.
      //
      // Mid-sentence protection: an interviewer often pauses mid-phrase and
      // the ASR fragment ends WITHOUT continuation punctuation (hyphen/comma)
      // because the recognizer normalizes it away. So flush() declining on
      // continuation punctuation is not enough — when flush returns "pending"
      // (or the text clearly reads unfinished: no terminal .!?), we re-arm the
      // timer with an EXTENDED window instead of dispatching early.
      //
      // The timer runs in a Worker, not on the main thread: Chromium throttles
      // setTimeout to ~1s granularity once the window is hidden, which is the
      // normal state for an overlay during a call. A sub-second gap threshold
      // is meaningless on a throttled timer, so questions would emit late.
      cancelGapTimerRef.current?.();
      const gapMs = asrTimingConfig.flushGapMs;
      /**
       * How many extra windows one pending question may hold back before it is
       * forced through.
       *
       * `looksUnfinished` treats any fragment without terminal punctuation as
       * mid-sentence, which is correct for a punctuating recogniser and fatal
       * for Parakeet: it emits no punctuation at all, so every flush returned
       * "pending", the timer re-armed itself, and the question was never asked
       * — the interviewer had long stopped and the AI stayed silent. One
       * extension still protects a real mid-sentence pause; after that the
       * accumulated text is a question by any practical measure.
       */
      let extensions = 0;
      const MAX_EXTENSIONS = 1;
      const arm = (delay: number) => {
        // Resolve until it succeeds: caching a `null` result disabled the
        // connection warm-up for the whole session, which cost the first
        // request its full TLS handshake on every answer.
        if (!activeProviderUrlRef.current) {
          activeProviderUrlRef.current = resolveActiveProviderUrl();
        }
        const warmUrl = activeProviderUrlRef.current;
        if (warmUrl) {
          void invoke("warm_llm_connection", { url: warmUrl }).catch(() => {});
        }
        cancelGapTimerRef.current = setUnthrottledTimeout(() => {
          cancelGapTimerRef.current = null;
          const forced = extensions >= MAX_EXTENSIONS;
          const emitted = questionAssemblerRef.current?.flush(
            "them",
            forced ? { allowContinuation: true } : undefined
          );
          if (emitted?.kind === "emitted") {
            void onTriggerAI(emitted.question, "them");
          } else if (emitted?.kind === "pending") {
            extensions += 1;
            // Speaker paused mid-sentence — one extended window is enough;
            // after that the text is forced through (see MAX_EXTENSIONS).
            arm(Math.round(gapMs * 1.4));
          }
        }, delay);
      };
      arm(gapMs);

      if (result.kind === "emitted") {
        cancelGapTimerRef.current?.();
        cancelGapTimerRef.current = null;
        await onTriggerAI(result.question, "them");
      }
    },
    [onTriggerAI, asrTimingConfig.flushGapMs]
  );

  return {
    activeFiller,
    setActiveFiller,
    pendingUtteranceId,
    setPendingUtteranceId,
    activeAskUtteranceIdRef,
    clearFiller,
    setFillerForAnchor,
    setFillerForInterviewer,
    resetQuestionAssembly,
    handleInterviewerTranscription,
    questionAssemblerRef,
  };
}
