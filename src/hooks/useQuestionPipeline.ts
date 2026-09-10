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
import {
  QuestionAssembler,
  ACTIVE_ASR_MODE,
  ASR_TIMING_PRESETS,
} from "@/lib/question-assembler";
import { selectRussianFiller } from "@/lib/transcript-stabilizer";
import { LiveSegment } from "./useConversationStore";

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
  const questionFlushTimerRef = useRef<NodeJS.Timeout | null>(null);
  const asrTimingConfig = ASR_TIMING_PRESETS[ACTIVE_ASR_MODE];

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
    (anchorId: string | null = null) => {
      // One filler phrase per answer: pick once, keep stable until cleared.
      // No rotation interval — the phrase must not change while the user
      // is reading it aloud mid-sentence.
      const filler = selectRussianFiller();
      setActiveFiller(filler);
      setPendingUtteranceId(anchorId);
      activeAskUtteranceIdRef.current = anchorId || "auto";
    },
    []
  );

  const setFillerForInterviewer = useCallback(() => {
    // Immediate display on dispatch: unbind from anchorId.
    // In case anchor exists in liveSegmentsRef, keep it for back-compat,
    // but filler is shown regardless (anchorId can be null or anchor.id).
    const anchor =
      [...liveSegmentsRef.current].reverse().find((s) => s.source === "them") ||
      null;
    setFillerForAnchor(anchor ? anchor.id : null);
  }, [liveSegmentsRef, setFillerForAnchor]);

  const resetQuestionAssembly = useCallback(() => {
    questionAssemblerRef.current?.reset();
    clearTimeout(questionFlushTimerRef.current ?? undefined);
    questionFlushTimerRef.current = null;
  }, []);

  const handleInterviewerTranscription = useCallback(
    async (transcription: string) => {
      const assembler = questionAssemblerRef.current!;
      const result = assembler.push({
        source: "them",
        text: transcription,
        timestamp: Date.now(),
      });

      if (result.kind === "discarded") {
        console.log(
          `[Pluely] Question fragment discarded (${result.reason}): "${transcription}"`
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
      clearTimeout(questionFlushTimerRef.current ?? undefined);
      const gapMs = asrTimingConfig.flushGapMs;
      const arm = (delay: number) => {
        questionFlushTimerRef.current = setTimeout(() => {
          questionFlushTimerRef.current = null;
          const emitted = questionAssemblerRef.current?.flush("them");
          if (emitted?.kind === "emitted") {
            void onTriggerAI(emitted.question, "them");
          } else if (emitted?.kind === "pending") {
            // Speaker paused mid-sentence — give them a generous second window
            // (2x the base gap) before forcing the question through.
            arm(gapMs * 2);
          }
        }, delay);
      };
      arm(gapMs);

      if (result.kind === "emitted") {
        clearTimeout(questionFlushTimerRef.current ?? undefined);
        questionFlushTimerRef.current = null;
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
