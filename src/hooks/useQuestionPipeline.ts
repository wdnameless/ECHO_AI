/**
 * Interviewer question assembler, gap timers, and filler logic (перебивки).
 *
 * Responsibility:
 * - Accumulates fragmented VAD transcription segments into single coherent questions.
 * - Handles flush timers on pauses/silence gaps.
 * - Manages active Russian filler state ("Да, секундочку..." / перебивки) and utterance association.
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
      const filler = selectRussianFiller();
      setActiveFiller(filler);
      setPendingUtteranceId(anchorId);
      activeAskUtteranceIdRef.current = anchorId || "auto";
    },
    []
  );

  const setFillerForInterviewer = useCallback(() => {
    const anchor =
      [...liveSegmentsRef.current].reverse().find((s) => s.source === "them") ||
      null;
    setFillerForAnchor(anchor ? anchor.id : null);
  }, [liveSegmentsRef, setFillerForAnchor]);

  const resetQuestionAssembly = useCallback(() => {
    questionAssemblerRef.current?.reset();
    if (questionFlushTimerRef.current) {
      clearTimeout(questionFlushTimerRef.current);
      questionFlushTimerRef.current = null;
    }
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
      if (questionFlushTimerRef.current) {
        clearTimeout(questionFlushTimerRef.current);
      }
      questionFlushTimerRef.current = setTimeout(() => {
        questionFlushTimerRef.current = null;
        const emitted = questionAssemblerRef.current?.flush("them");
        if (emitted?.kind === "emitted") {
          void onTriggerAI(emitted.question, "them");
        }
      }, asrTimingConfig.flushGapMs);

      if (result.kind === "emitted") {
        if (questionFlushTimerRef.current) {
          clearTimeout(questionFlushTimerRef.current);
          questionFlushTimerRef.current = null;
        }
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
