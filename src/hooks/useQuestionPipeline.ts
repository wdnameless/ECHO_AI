/**
 * Interviewer question assembler, gap timers, monologue buffer, and filler logic (перебивки).
 *
 * Responsibility:
 * - Accumulates fragmented VAD transcription segments into coherent questions or monologue blocks.
 * - Handles flush timers on pauses/silence gaps.
 * - Reconfigures QuestionAssembler and MonologueBuffer on profile changes with timer reset.
 * - Monologue buffer accumulates non-stop speech into one history prompt,
 *   supporting auto (default), semi-confirm, and manual-button dispatch.
 * - Manages active Russian filler state ("Да, секундочку..." / перебивки).
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { warmProviderConnection } from "@/lib/host-trust-gate";
import {
  QuestionAssembler,
  ACTIVE_ASR_MODE,
  ASR_TIMING_PRESETS,
} from "@/lib/question-assembler";
import {
  MonologueBuffer,
  MonologueMode,
  MonologueStatus,
  MONOLOGUE_EVENTS,
} from "@/lib/monologue-buffer";
export const TURN_GATE_EVENT = "turngate:answer-anyway";
export const TURN_GATE_STATUS_EVENT = "turngate:status";
import {
  PromptProfile,
  getActiveProfile,
} from "@/lib/storage/prompt-profiles";
import { selectFillerForText } from "@/lib/transcript-stabilizer";
import { setUnthrottledTimeout } from "@/lib/timer-worker";
import { safeLocalStorage } from "@/lib/storage/helper";
import { STORAGE_KEYS } from "@/config/constants";
import { AI_PROVIDERS } from "@/config/ai-providers.constants";
import { deepVariableReplacer } from "@/lib/functions/common.function";
import { LiveSegment } from "./useConversationStore";

export function resolveActiveProviderUrl(): string | null {
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
  profile?: PromptProfile;
}

export function useQuestionPipeline({
  onTriggerAI,
  liveSegmentsRef,
  profile: propProfile,
}: UseQuestionPipelineProps) {
  const [activeFiller, setActiveFiller] = useState<string | null>(null);
  const [pendingUtteranceId, setPendingUtteranceId] = useState<string | null>(null);
  const activeAskUtteranceIdRef = useRef<string | null>(null);

  const [currentProfile, setCurrentProfile] = useState<PromptProfile>(() => {
    return propProfile ?? getActiveProfile();
  });

  const questionAssemblerRef = useRef<QuestionAssembler | null>(null);
  const monologueBufferRef = useRef<MonologueBuffer | null>(null);
  const cancelGapTimerRef = useRef<(() => void) | null>(null);
  const activeProviderUrlRef = useRef<string | null>(null);

  const [monologueStatus, setMonologueStatus] = useState<MonologueStatus>("idle");
  const [monologueText, setMonologueText] = useState<string>("");
  const [isMonologueReady, setIsMonologueReady] = useState<boolean>(false);
  const [turnGateWaiting, setTurnGateWaiting] = useState<boolean>(false);

  // Initialize assembler and monologue buffer
  if (!questionAssemblerRef.current) {
    const p = propProfile ?? getActiveProfile();
    questionAssemblerRef.current = new QuestionAssembler({
      mode: ACTIVE_ASR_MODE,
      flushGapMs: p.flushGapMs ?? ASR_TIMING_PRESETS[ACTIVE_ASR_MODE].flushGapMs,
      maxWindowMs: p.monologue?.maxWindow ?? ASR_TIMING_PRESETS[ACTIVE_ASR_MODE].maxWindowMs,
    });
  }

  if (!monologueBufferRef.current) {
    const p = propProfile ?? getActiveProfile();
    monologueBufferRef.current = new MonologueBuffer({
      mode: p.monologue?.mode ?? "auto",
      flushGapMs: p.flushGapMs ?? 1500,
      maxWindowMs: p.monologue?.maxWindow ?? 15000,
      onStatusChange: (status) => {
        setMonologueStatus(status);
        setIsMonologueReady(status === "ready");
      },
    });
  }

  const resetTimersAndAssembly = useCallback(() => {
    cancelGapTimerRef.current?.();
    cancelGapTimerRef.current = null;
    questionAssemblerRef.current?.reset();
    monologueBufferRef.current?.clear();
    setMonologueStatus("idle");
    setMonologueText("");
    setIsMonologueReady(false);
  }, []);

  const reconfigureProfile = useCallback(
    (profile: PromptProfile) => {
      resetTimersAndAssembly();
      setCurrentProfile(profile);

      const flushGapMs = profile.flushGapMs ?? ASR_TIMING_PRESETS[ACTIVE_ASR_MODE].flushGapMs;
      const maxWindowMs = profile.monologue?.maxWindow ?? ASR_TIMING_PRESETS[ACTIVE_ASR_MODE].maxWindowMs;
      const mode: MonologueMode = profile.monologue?.mode ?? "auto";

      questionAssemblerRef.current?.reconfigure({
        flushGapMs,
        maxWindowMs,
      });

      monologueBufferRef.current?.reconfigure({
        mode,
        flushGapMs,
        maxWindowMs,
      });
    },
    [resetTimersAndAssembly]
  );

  // Update when prop changes
  useEffect(() => {
    if (propProfile) {
      reconfigureProfile(propProfile);
    }
  }, [propProfile, reconfigureProfile]);

  // Listen to profile changes from other tabs or settings
  useEffect(() => {
    const handleProfileChange = (e: Event) => {
      const customEvent = e as CustomEvent<PromptProfile>;
      if (customEvent.detail) {
        reconfigureProfile(customEvent.detail);
      } else {
        reconfigureProfile(getActiveProfile());
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("prompt-profile-changed", handleProfileChange);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("prompt-profile-changed", handleProfileChange);
      }
    };
  }, [reconfigureProfile]);

  // Teardown
  useEffect(() => {
    return () => {
      cancelGapTimerRef.current?.();
      cancelGapTimerRef.current = null;
    };
  }, []);
  useEffect(() => {
    // Warmup at session start not trailing edge
    if (!activeProviderUrlRef.current) {
      activeProviderUrlRef.current = resolveActiveProviderUrl();
    }
    const warmUrl = activeProviderUrlRef.current;
    if (warmUrl) {
      void warmProviderConnection(warmUrl).catch(() => {});
    }
  }, []);


  const clearFiller = useCallback(() => {
    setActiveFiller(null);
    setPendingUtteranceId(null);
    activeAskUtteranceIdRef.current = null;
  }, []);

  const setFillerForAnchor = useCallback(
    (anchorId: string | null = null, questionText = "") => {
      const filler = selectFillerForText(questionText);
      setActiveFiller(filler);
      setPendingUtteranceId(anchorId);
      activeAskUtteranceIdRef.current = anchorId || "auto";
    },
    []
  );

  const setFillerForInterviewer = useCallback(
    (questionText = "") => {
      const anchor =
        [...liveSegmentsRef.current].reverse().find((s) => s.source === "them") ||
        null;
      setFillerForAnchor(anchor ? anchor.id : null, questionText);
    },
    [liveSegmentsRef, setFillerForAnchor]
  );

  const resetQuestionAssembly = useCallback(() => {
    resetTimersAndAssembly();
  }, [resetTimersAndAssembly]);

  // Monologue manual flush & semi-confirm methods
  const flushMonologue = useCallback(async (): Promise<string | null> => {
    cancelGapTimerRef.current?.();
    cancelGapTimerRef.current = null;
    const flushed = monologueBufferRef.current?.flush();
    questionAssemblerRef.current?.reset();
    setMonologueText("");
    setIsMonologueReady(false);
    setMonologueStatus("idle");

    if (flushed && flushed.text) {
      await onTriggerAI(flushed.text, "them");
      return flushed.text;
    }
    return null;
  }, [onTriggerAI]);

  const confirmMonologue = useCallback(async (): Promise<string | null> => {
    return flushMonologue();
  }, [flushMonologue]);

  const cancelMonologue = useCallback(() => {
    cancelGapTimerRef.current?.();
    cancelGapTimerRef.current = null;
    monologueBufferRef.current?.clear();
    questionAssemblerRef.current?.reset();
    setMonologueText("");
    setIsMonologueReady(false);
    setMonologueStatus("idle");
  }, []);
  // Turn-gate force answer (R06): dispatches whatever the assembler holds,
  // bypassing the gap timer. Fired from the overlay "ответить всё равно" button.
  const answerAnyway = useCallback(async (): Promise<string | null> => {
    cancelGapTimerRef.current?.();
    cancelGapTimerRef.current = null;
    const emitted = questionAssemblerRef.current?.flush("them", { allowContinuation: true });
    setTurnGateWaiting(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(TURN_GATE_STATUS_EVENT, { detail: false }));
    }
    if (emitted?.kind === "emitted" && emitted.question) {
      await onTriggerAI(emitted.question, "them");
      return emitted.question;
    }
    return null;
  }, [onTriggerAI]);

  // Listen to monologue events
  useEffect(() => {
    const handleConfirm = () => {
      void confirmMonologue();
    };
    const handleFlush = () => {
      void flushMonologue();
    };
    const handleCancel = () => {
      cancelMonologue();
    };
    const handleAnswerAnyway = () => {
      void answerAnyway();
    };

    if (typeof window !== "undefined") {
      window.addEventListener(MONOLOGUE_EVENTS.CONFIRM, handleConfirm);
      window.addEventListener(MONOLOGUE_EVENTS.FLUSH, handleFlush);
      window.addEventListener(MONOLOGUE_EVENTS.CANCEL, handleCancel);
      window.addEventListener(TURN_GATE_EVENT, handleAnswerAnyway);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(MONOLOGUE_EVENTS.CONFIRM, handleConfirm);
        window.removeEventListener(MONOLOGUE_EVENTS.FLUSH, handleFlush);
        window.removeEventListener(MONOLOGUE_EVENTS.CANCEL, handleCancel);
        window.removeEventListener(TURN_GATE_EVENT, handleAnswerAnyway);
      }
    };
  }, [confirmMonologue, flushMonologue, cancelMonologue, answerAnyway]);

  const handleInterviewerTranscription = useCallback(
    async (transcription: string, pauseBeforeMs?: number) => {
      const assembler = questionAssemblerRef.current!;
      const monoBuffer = monologueBufferRef.current!;
      const profile = currentProfile;
      const monoMode: MonologueMode = profile.monologue?.mode ?? "auto";

      const monoPush = monoBuffer.push(transcription);
      setMonologueText(monoPush.text);

      const result = assembler.push({
        source: "them",
        text: transcription,
        timestamp: Date.now(),
        pauseBeforeMs,
      });

      if (result.kind === "discarded") {
        console.log(
          `[Echo AI] Question fragment discarded (${result.reason}): "${transcription}"`
        );
        return;
      }

      // Fast-path in interview mode on explicit question mark
      if (
        result.kind === "emitted" &&
        monoMode === "auto" &&
        profile.interviewMode &&
        !monoPush.windowExceeded
      ) {
        cancelGapTimerRef.current?.();
        cancelGapTimerRef.current = null;
        monoBuffer.clear();
        setTurnGateWaiting(false);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(TURN_GATE_STATUS_EVENT, { detail: false }));
        }
        setMonologueText("");
        setIsMonologueReady(false);
        setMonologueStatus("idle");
        await onTriggerAI(result.question, "them");
        return;
      }

      // If maxWindow is exceeded during non-stop monologue in auto mode, emit immediately
      if (monoPush.shouldEmit) {
        cancelGapTimerRef.current?.();
        cancelGapTimerRef.current = null;
        const flushed = monoBuffer.flush();
        assembler.reset();
        setMonologueText("");
        setIsMonologueReady(false);
        setMonologueStatus("idle");
        if (flushed && flushed.text) {
          await onTriggerAI(flushed.text, "them");
        }
        return;
      }

      // (Re)arm gap timer
      cancelGapTimerRef.current?.();
      const gapMs = profile.flushGapMs ?? assembler.currentGapMs;
      let extensions = 0;
      const MAX_EXTENSIONS = 1;

      const arm = (delay: number) => {

        cancelGapTimerRef.current = setUnthrottledTimeout(() => {
          cancelGapTimerRef.current = null;

          if (monoMode === "semi") {
            monoBuffer.onSilenceGap();
            setIsMonologueReady(true);
            setMonologueStatus("ready");
            return;
          }

          if (monoMode === "manual") {
            monoBuffer.onSilenceGap();
            return;
          }

          // Auto mode
          const forced = extensions >= MAX_EXTENSIONS;
          const emitted = assembler.flush(
            "them",
            forced ? { allowContinuation: true } : undefined
          );

          if (emitted?.kind === "emitted") {
            const flushedMono = monoBuffer.flush();
            const textToSend =
              flushedMono && flushedMono.text.length >= emitted.question.length
                ? flushedMono.text
                : emitted.question;
            setMonologueText("");
            setIsMonologueReady(false);
            setMonologueStatus("idle");
            setTurnGateWaiting(false);
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent(TURN_GATE_STATUS_EVENT, { detail: false }));
            }
            void onTriggerAI(textToSend, "them");
          } else if (emitted?.kind === "pending") {
            extensions += 1;
            arm(Math.round(gapMs * 1.4));
          } else if (!monoBuffer.isEmpty()) {
            const flushed = monoBuffer.flush();
            setMonologueText("");
            setIsMonologueReady(false);
            setMonologueStatus("idle");
            if (flushed && flushed.text) {
              void onTriggerAI(flushed.text, "them");
            }
          }
        }, delay);
      };

      arm(gapMs);
      setTurnGateWaiting(true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(TURN_GATE_STATUS_EVENT, { detail: true }));
      }

      // If assembler emitted without punctuation wait (and not in non-stop accumulation)
      if (
        result.kind === "emitted" &&
        monoMode === "auto" &&
        profile.interviewMode
      ) {
        cancelGapTimerRef.current?.();
        cancelGapTimerRef.current = null;
        monoBuffer.clear();
        setMonologueText("");
        setIsMonologueReady(false);
        setMonologueStatus("idle");
        await onTriggerAI(result.question, "them");
      }
    },
    [onTriggerAI, currentProfile]
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
    // Monologue additions
    monologueBufferRef,
    monologueStatus,
    monologueText,
    isMonologueReady,
    confirmMonologue,
    flushMonologue,
    cancelMonologue,
    reconfigureProfile,
    currentProfile,
    turnGateWaiting,
    answerAnyway,
  };
}
