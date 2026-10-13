import { useState, useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { FLUSH_SAFETY_TIMEOUT_MS } from "./types";

export interface UseRecoveryProps {
  setIsSystemProcessing: (v: boolean) => void;
  setIsAIProcessing: (v: boolean) => void;
  setIsRecordingInContinuousMode: (v: boolean) => void;
  setError: (err: string) => void;
  onSpeechDiscarded?: () => void;
}

export function useRecovery({
  setIsSystemProcessing,
  setIsAIProcessing,
  setIsRecordingInContinuousMode,
  setError,
  onSpeechDiscarded,
}: UseRecoveryProps) {
  const captureEpochRef = useRef(0);
  const speechEpochRef = useRef(0);

  const [recordingProgress, setRecordingProgress] = useState<number>(0);

  const flushSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAudioSpeechEndRef = useRef<number | null>(null);
  const pauseBeforeUtteranceRef = useRef<number>(0);
  const utteranceStartedAtRef = useRef<number | null>(null);

  const onSpeechDiscardedRef = useRef(onSpeechDiscarded);
  onSpeechDiscardedRef.current = onSpeechDiscarded;

  const clearFlushSafety = useCallback((): boolean => {
    if (flushSafetyTimerRef.current !== null) {
      clearTimeout(flushSafetyTimerRef.current);
      flushSafetyTimerRef.current = null;
      return true;
    }
    return false;
  }, []);

  const scheduleFlushSafety = useCallback(
    (onTimeout: () => void, timeoutMs: number = FLUSH_SAFETY_TIMEOUT_MS) => {
      if (flushSafetyTimerRef.current !== null) {
        clearTimeout(flushSafetyTimerRef.current);
      }
      flushSafetyTimerRef.current = setTimeout(() => {
        flushSafetyTimerRef.current = null;
        onTimeout();
      }, timeoutMs);
    },
    []
  );

  const markSpeechEnd = useCallback(() => {
    lastAudioSpeechEndRef.current = Date.now();
  }, []);

  const recordSpeechStart = useCallback(() => {
    if (lastAudioSpeechEndRef.current !== null) {
      pauseBeforeUtteranceRef.current = Math.max(
        0,
        Date.now() - lastAudioSpeechEndRef.current
      );
    }
    utteranceStartedAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    const addListener = (unlisten: () => void) => {
      if (cancelled) {
        unlisten();
      } else {
        unlisteners.push(unlisten);
      }
    };

    const setupContinuousListeners = async () => {
      try {
        const progressUnlisten = await listen("recording-progress", (event) => {
          const seconds = event.payload as number;
          setRecordingProgress(seconds);
        });
        addListener(progressUnlisten);

        const startUnlisten = await listen("continuous-recording-start", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(true);
        });
        addListener(startUnlisten);

        const stopUnlisten = await listen("continuous-recording-stopped", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(false);
        });
        addListener(stopUnlisten);

        const errorUnlisten = await listen("audio-encoding-error", (event) => {
          const errorMsg = event.payload as string;
          console.error("Audio encoding error:", errorMsg);
          setError(`Failed to process audio: ${errorMsg}`);
          setIsSystemProcessing(false);
          setIsAIProcessing(false);
          setIsRecordingInContinuousMode(false);
        });
        addListener(errorUnlisten);

        const discardedUnlisten = await listen("speech-discarded", (event) => {
          const reason = event.payload as string;
          console.log("Speech discarded:", reason);
          onSpeechDiscardedRef.current?.();
        });
        addListener(discardedUnlisten);
      } catch (err) {
        console.error("Failed to setup continuous recording listeners:", err);
      }
    };

    void setupContinuousListeners();

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
      unlisteners.length = 0;
    };
  }, [setIsAIProcessing, setError, setIsSystemProcessing, setIsRecordingInContinuousMode]);

  useEffect(() => {
    return () => {
      captureEpochRef.current += 1;
      clearFlushSafety();
    };
  }, [clearFlushSafety]);

  return {
    captureEpochRef,
    speechEpochRef,
    recordingProgress,
    setRecordingProgress,
    flushSafetyTimerRef,
    clearFlushSafety,
    scheduleFlushSafety,
    lastAudioSpeechEndRef,
    pauseBeforeUtteranceRef,
    utteranceStartedAtRef,
    markSpeechEnd,
    recordSpeechStart,
  };
}
