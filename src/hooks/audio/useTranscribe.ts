import { useState, useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { buildInitialPrompt } from "@/lib/vocab";
import { transcribeWithFallback, isSttErrorMessage } from "@/lib/functions";
import { recordPartialLatency, recordFirstText } from "@/lib/metrics";
import { micStateStore } from "@/stores/mic-state";
import { useThemWsStreaming } from "../useThemWsStreaming";
import { getAsrCapabilities } from "@/lib/asr-capabilities";
import { isAsrModelBusyError, withNoStream } from "@/lib/asr-gate";
import {
  decodeSpeechFramePayload,
  encodeWav16kMono,
  hasSpeechEnergy,
  FLUSH_SAFETY_TIMEOUT_MS,
  LIVE_BATCH_MS,
  LIVE_MAX_UTTERANCE_MS,
  type VadConfig,
} from "./types";

export interface UseTranscribeProps {
  capturing: boolean;
  capturingRef: React.MutableRefObject<boolean>;
  captureEpochRef: React.MutableRefObject<number>;
  speechEpochRef: React.MutableRefObject<number>;
  vadConfig: VadConfig;
  selectedSttProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  appendLiveSegment: (source: "me" | "them", text: string, isPartial?: boolean) => void;
  onInterviewerTranscription: (text: string, pauseBeforeMs?: number) => Promise<void>;
  onInterviewerSpeechActivity?: () => void;
  setMyLastTranscription: (text: string) => void;
  setTheirLastTranscription: (text: string) => void;
  setError: (err: string) => void;
  clearFlushSafety: () => boolean;
  scheduleFlushSafety: (onTimeout: () => void, timeoutMs?: number) => void;
  markSpeechEnd: () => void;
  recordSpeechStart: () => void;
  pauseBeforeUtteranceRef: React.MutableRefObject<number>;
  utteranceStartedAtRef: React.MutableRefObject<number | null>;
}

export interface UseTranscribeResult {
  isMicProcessing: boolean;
  setIsMicProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  isSystemProcessing: boolean;
  setIsSystemProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  transcribeSegment: (
    audioBlob: Blob,
    source: "me" | "them",
    options?: {
      skipOnInterviewerTranscription?: boolean;
      pauseBeforeMs?: number;
      isCoveredByOtherPath?: () => boolean;
    }
  ) => Promise<void>;
  canStream: () => boolean;
  themIsStreaming: () => boolean;
  yieldThemToMic: () => void;
  releaseMicModelOwnership: () => void;
  resetOnCaptureChange: (next: boolean) => void;
  onSpeechDiscarded: () => void;
}

export function useTranscribe({
  capturing,
  capturingRef,
  captureEpochRef,
  speechEpochRef,
  vadConfig,
  selectedSttProvider,
  appendLiveSegment,
  onInterviewerTranscription,
  onInterviewerSpeechActivity,
  setMyLastTranscription,
  setTheirLastTranscription,
  setError,
  clearFlushSafety,
  scheduleFlushSafety,
  markSpeechEnd,
  recordSpeechStart,
  pauseBeforeUtteranceRef,
  utteranceStartedAtRef,
}: UseTranscribeProps): UseTranscribeResult {
  const [isMicProcessing, setIsMicProcessing] = useState(false);
  const [isSystemProcessing, setIsSystemProcessing] = useState(false);

  const streamingModelRef = useRef(false);
  const micStreamOwnsModelRef = useRef(false);
  const utteranceActiveRef = useRef(false);
  const rolledTextRef = useRef("");
  const utteranceEndedRef = useRef(false);
  const flushUtteranceRef = useRef<() => void>(() => {});
  const runLiveBatchRef = useRef<() => Promise<void>>(async () => {});
  const livePcmRef = useRef<Uint8Array[]>([]);
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTextRef = useRef("");
  const liveBusyRef = useRef(false);
  const handleSpeechDetectedRef = useRef<(base64Audio: string) => void>(() => {});

  const themWs = useThemWsStreaming({
    capturingRef,
    selectedSttProvider,
    onPartialTranscript: (text) => {
      if (!capturingRef.current) return;
      onInterviewerSpeechActivity?.();
      appendLiveSegment("them", text, true);
    },
    onFinalTranscript: (text) => {
      if (!capturingRef.current) return;
      onInterviewerSpeechActivity?.();
      const chunk = text.trim();
      if (!chunk) return;

      rolledTextRef.current = [rolledTextRef.current, chunk]
        .filter(Boolean)
        .join(" ");

      if (utteranceEndedRef.current) {
        utteranceEndedRef.current = false;
        flushUtteranceRef.current();
        return;
      }

      appendLiveSegment("them", rolledTextRef.current, true);
    },
  });
  const themWsRef = useRef(themWs);
  themWsRef.current = themWs;

  flushUtteranceRef.current = () => {
    clearFlushSafety();
    const whole = rolledTextRef.current.trim();
    rolledTextRef.current = "";
    utteranceEndedRef.current = false;
    if (!whole) return;
    setTheirLastTranscription(whole);
    appendLiveSegment("them", whole);
    void onInterviewerTranscription(whole);
  };

  const transcribeSegment = useCallback(
    async (
      audioBlob: Blob,
      source: "me" | "them",
      options?: {
        skipOnInterviewerTranscription?: boolean;
        pauseBeforeMs?: number;
        isCoveredByOtherPath?: () => boolean;
      }
    ) => {
      const epoch = captureEpochRef.current;
      const isCurrent = () =>
        epoch === captureEpochRef.current &&
        (source === "me" || capturingRef.current);
      if (!isCurrent()) return;
      const setSegmentProcessing =
        source === "me" ? setIsMicProcessing : setIsSystemProcessing;

      try {
        setSegmentProcessing(true);

        const batchStarted = Date.now();

        const sttPromise = withNoStream(
          () =>
            isCurrent()
              ? transcribeWithFallback({
                  selectedProvider: selectedSttProvider,
                  audio: audioBlob,
                  priority: "high",
                  prompt: buildInitialPrompt(),
                })
              : Promise.resolve(""),
          source === "them" ? 45000 : 5000
        );

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<string>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Speech transcription timed out (45s)")),
            45000
          );
        });

        let transcription: string;
        try {
          transcription = await Promise.race([sttPromise, timeoutPromise]);
        } finally {
          clearTimeout(timeoutId);
        }
        if (!isCurrent()) return;
        recordPartialLatency(Date.now() - batchStarted);

        if (transcription.trim()) {
          const currentMicMode = micStateStore.getState().mode;
          if (source === "me" && currentMicMode === "IDLE") {
            setError("");
            return;
          }

          if (source === "me") {
            setMyLastTranscription(transcription);
          } else {
            setTheirLastTranscription(transcription);
          }
          appendLiveSegment(source, transcription);
          setError("");

          if (source === "me") {
            return;
          }

          if (source === "them") {
            livePcmRef.current = [];
            liveTextRef.current = "";
            utteranceStartedAtRef.current = null;
          }

          if (source === "them" && !options?.skipOnInterviewerTranscription) {
            await onInterviewerTranscription(
              transcription,
              options?.pauseBeforeMs ?? 0
            );
          }
        } else {
          setError("");
        }
      } catch (sttError: unknown) {
        if (!isCurrent()) return;
        if (isAsrModelBusyError(sttError)) {
          if (source === "me" && !options?.isCoveredByOtherPath?.()) {
            setError("Распознавание занято другим каналом, речь пропущена");
            return;
          }
          console.debug("[system-audio] batch skipped, stream holds model:", sttError.owner);
          return;
        }
        console.error("STT Error:", sttError);
      } finally {
        if (isCurrent()) setSegmentProcessing(false);
      }
    },
    [
      captureEpochRef,
      capturingRef,
      selectedSttProvider,
      appendLiveSegment,
      onInterviewerTranscription,
      setMyLastTranscription,
      setTheirLastTranscription,
      setError,
      utteranceStartedAtRef,
    ]
  );

  useEffect(() => {
    handleSpeechDetectedRef.current = async (base64Audio: string) => {
      try {
        if (!capturingRef.current) return;
        const pauseBeforeMs = pauseBeforeUtteranceRef.current;
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const audioBlob = new Blob([bytes], { type: "audio/wav" });

        await transcribeSegment(audioBlob, "them", { pauseBeforeMs });
      } catch (err) {
        console.warn("[system-audio]", err);
        setError("Failed to process speech");
      }
    };
  });

  const runLiveBatch = useCallback(async () => {
    if (!capturingRef.current) return;
    if (liveBusyRef.current) return;
    liveBusyRef.current = true;
    const frames = livePcmRef.current;
    livePcmRef.current = [];
    if (frames.length === 0) {
      liveBusyRef.current = false;
      return;
    }

    let sampleCount = 0;
    for (const f of frames) sampleCount += f.length;
    const maxSamples = LIVE_MAX_UTTERANCE_MS;
    let skipBytes = 0;
    if (sampleCount / 4 > maxSamples) {
      skipBytes = (sampleCount / 4 - maxSamples) * 4;
    }

    const pcm = new Int16Array(Math.floor((sampleCount - skipBytes) / 4));
    let written = 0;
    let consumed = 0;
    for (const f of frames) {
      if (consumed + f.byteLength <= skipBytes) {
        consumed += f.byteLength;
        continue;
      }
      const view = new DataView(f.buffer, f.byteOffset, f.byteLength);
      for (let o = 0; o + 4 <= f.byteLength; o += 4) {
        if (consumed + o < skipBytes) continue;
        const v = view.getFloat32(o, true);
        if (written >= pcm.length) break;
        pcm[written++] = Math.max(-1, Math.min(1, v)) * 32767;
      }
      consumed += f.byteLength;
    }

    if (!hasSpeechEnergy(pcm.subarray(0, written), vadConfig)) {
      liveBusyRef.current = false;
      return;
    }

    const wav = encodeWav16kMono(pcm.subarray(0, written));
    const started = Date.now();
    const epoch = speechEpochRef.current;
    try {
      const text = await transcribeWithFallback({
        selectedProvider: selectedSttProvider,
        audio: new Blob([wav], { type: "audio/wav" }),
        priority: "high",
        prompt: buildInitialPrompt(),
      });
      if (epoch !== speechEpochRef.current) return;
      const clean = text.trim();
      if (!clean || isSttErrorMessage(clean)) return;
      recordPartialLatency(Date.now() - started);
      if (utteranceStartedAtRef.current !== null && liveTextRef.current === "") {
        recordFirstText(Date.now() - utteranceStartedAtRef.current);
      }
      if (clean.length >= liveTextRef.current.length) {
        liveTextRef.current = clean;
        appendLiveSegment("them", clean, true);
      }
    } catch {
      // A dropped live pass is not an error: the next one covers the audio.
    } finally {
      liveBusyRef.current = false;
    }
  }, [
    appendLiveSegment,
    capturingRef,
    selectedSttProvider,
    speechEpochRef,
    utteranceStartedAtRef,
    vadConfig,
  ]);
  runLiveBatchRef.current = runLiveBatch;

  useEffect(() => {
    let frameUnlisten: (() => void) | undefined;
    let cancelled = false;

    listen<unknown>("speech-frame", (event) => {
      if (!capturingRef.current) return;
      const bytes = decodeSpeechFramePayload(event.payload);
      if (!bytes) return;
      if (streamingModelRef.current) {
        if (micStreamOwnsModelRef.current) return;
        themWsRef.current.feedFrame(bytes.buffer as ArrayBuffer);
        return;
      }
      livePcmRef.current.push(new Uint8Array(bytes.buffer as ArrayBuffer));
      if (liveTimerRef.current === null) {
        liveTimerRef.current = setTimeout(() => {
          liveTimerRef.current = null;
          void runLiveBatchRef.current();
        }, LIVE_BATCH_MS);
      }
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          frameUnlisten = unlisten;
        }
      })
      .catch((err) => {
        console.warn("[system-audio] frame listener failed:", err);
      });

    return () => {
      cancelled = true;
      if (frameUnlisten) frameUnlisten();
    };
  }, [capturingRef]);

  useEffect(() => {
    let startUnlisten: (() => void) | undefined;
    let cancellable = false;

    listen("speech-start", () => {
      if (!capturingRef.current) return;
      utteranceActiveRef.current = true;
      const epoch = ++speechEpochRef.current;
      recordSpeechStart();
      if (clearFlushSafety()) {
        flushUtteranceRef.current();
      }
      rolledTextRef.current = "";
      utteranceEndedRef.current = false;
      livePcmRef.current = [];
      liveTextRef.current = "";
      void (async () => {
        const caps = await getAsrCapabilities();
        if (epoch !== speechEpochRef.current || !capturingRef.current) return;
        streamingModelRef.current = caps.streaming;
        if (!caps.streaming || micStreamOwnsModelRef.current) return;
        themWsRef.current.beginUtterance();
        themWsRef.current.start();
      })();
    })
      .then((unlisten) => {
        if (cancellable) {
          unlisten();
        } else {
          startUnlisten = unlisten;
        }
      })
      .catch((err) => {
        console.warn("[system-audio] speech-start listener failed:", err);
      });

    return () => {
      cancellable = true;
      if (startUnlisten) startUnlisten();
    };
  }, [capturingRef, clearFlushSafety, recordSpeechStart, speechEpochRef]);

  useEffect(() => {
    let speechUnlisten: (() => void) | undefined;
    let cancelled = false;

    listen("speech-detected", (event) => {
      markSpeechEnd();
      utteranceActiveRef.current = false;
      speechEpochRef.current += 1;
      if (
        !micStreamOwnsModelRef.current &&
        streamingModelRef.current &&
        themWsRef.current.isStreaming()
      ) {
        onInterviewerSpeechActivity?.();
        utteranceEndedRef.current = true;
        clearFlushSafety();
        scheduleFlushSafety(() => {
          flushUtteranceRef.current();
          themWsRef.current.finalizeAndClose();
        }, FLUSH_SAFETY_TIMEOUT_MS);
        themWsRef.current.finalizeUtterance();
        return;
      }

      onInterviewerSpeechActivity?.();
      if (liveTimerRef.current !== null) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }

      clearFlushSafety();
      rolledTextRef.current = "";
      utteranceEndedRef.current = false;
      themWsRef.current.close();
      handleSpeechDetectedRef.current(event.payload as string);
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          speechUnlisten = unlisten;
        }
      })
      .catch((err) => {
        console.warn("[system-audio]", err);
        setError("Failed to setup speech listener");
      });

    return () => {
      cancelled = true;
      if (speechUnlisten) speechUnlisten();
    };
  }, [
    clearFlushSafety,
    markSpeechEnd,
    onInterviewerSpeechActivity,
    scheduleFlushSafety,
    setError,
    speechEpochRef,
  ]);

  useEffect(() => {
    if (!capturing) {
      utteranceActiveRef.current = false;
      themWsRef.current.finalizeAndClose();
      speechEpochRef.current += 1;
      if (liveTimerRef.current !== null) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }
      livePcmRef.current = [];
      liveTextRef.current = "";
      utteranceStartedAtRef.current = null;
    }
    return () => {
      utteranceActiveRef.current = false;
      micStreamOwnsModelRef.current = false;
      themWsRef.current.finalizeAndClose();
      if (liveTimerRef.current !== null) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    };
  }, [capturing, speechEpochRef, utteranceStartedAtRef]);

  useEffect(() => {
    const epoch = captureEpochRef.current;
    if (capturing) {
      void (async () => {
        const caps = await getAsrCapabilities();
        if (epoch !== captureEpochRef.current || !capturingRef.current) return;
        streamingModelRef.current = caps.streaming;
      })();
    }
  }, [capturing, captureEpochRef, capturingRef]);

  const canStream = useCallback(() => streamingModelRef.current, []);

  const themIsStreaming = useCallback(
    () => themWsRef.current.isStreaming(),
    []
  );

  const yieldThemToMic = useCallback(() => {
    micStreamOwnsModelRef.current = true;
    speechEpochRef.current += 1;
    themWsRef.current.finalizeAndClose();
  }, [speechEpochRef]);

  const releaseMicModelOwnership = useCallback(() => {
    micStreamOwnsModelRef.current = false;
    if (
      capturingRef.current &&
      streamingModelRef.current &&
      utteranceActiveRef.current
    ) {
      themWsRef.current.beginUtterance();
      themWsRef.current.start();
    }
  }, [capturingRef]);

  const resetOnCaptureChange = useCallback((next: boolean) => {
    rolledTextRef.current = "";
    utteranceEndedRef.current = false;
    if (!next) {
      utteranceActiveRef.current = false;
      themWsRef.current.close();
    }
  }, []);

  const onSpeechDiscarded = useCallback(() => {
    utteranceActiveRef.current = false;
    if (streamingModelRef.current) {
      themWsRef.current.finalizeAndClose();
    }
  }, []);

  return {
    isMicProcessing,
    setIsMicProcessing,
    isSystemProcessing,
    setIsSystemProcessing,
    transcribeSegment,
    canStream,
    themIsStreaming,
    yieldThemToMic,
    releaseMicModelOwnership,
    resetOnCaptureChange,
    onSpeechDiscarded,
  };
}
