import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { safeLocalStorage, shouldUsePluelyAPI } from "@/lib";
import { buildInitialPrompt } from "@/lib/vocab";
import { isSttErrorMessage, transcribeWithFallback } from "@/lib/functions";
import type { TYPE_PROVIDER } from "@/types";
import { micStateStore } from "@/stores/mic-state";

export interface VadConfig {
  enabled: boolean;
  hop_size: number;
  sensitivity_rms: number;
  peak_threshold: number;
  silence_chunks: number;
  min_speech_chunks: number;
  pre_speech_chunks: number;
  noise_gate_threshold: number;
  max_recording_duration_secs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  enabled: true,
  hop_size: 1024,
  sensitivity_rms: 0.012,
  peak_threshold: 0.035,
  silence_chunks: 15, // ~330ms of silence before stopping (fast path)
  min_speech_chunks: 7,
  pre_speech_chunks: 12,
  noise_gate_threshold: 0.003,
  max_recording_duration_secs: 180,
};

interface UseSystemAudioCaptureProps {
  selectedAudioDevices: {
    input: { id: string; name: string };
    output: { id: string; name: string };
  };
  selectedSttProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  allSttProviders: TYPE_PROVIDER[];
  appendLiveSegment: (source: "me" | "them", text: string, isPartial?: boolean) => void;
  onInterviewerTranscription: (text: string) => Promise<void>;
  onInterviewerSpeechActivity?: () => void;
  setMyLastTranscription: (text: string) => void;
  setTheirLastTranscription: (text: string) => void;
  setIsAIProcessing: (v: boolean) => void;
  setError: (err: string) => void;
}

export function useSystemAudioCapture(props: UseSystemAudioCaptureProps) {
  const {
    selectedAudioDevices,
    selectedSttProvider,
    allSttProviders,
    appendLiveSegment,
    onInterviewerTranscription,
    onInterviewerSpeechActivity,
    setMyLastTranscription,
    setTheirLastTranscription,
    setIsAIProcessing,
    setError,
  } = props;

  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef<boolean>(capturing);
  const [isMicProcessing, setIsMicProcessing] = useState(false);
  const [isSystemProcessing, setIsSystemProcessing] = useState(false);
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const [vadConfig, setVadConfig] = useState<VadConfig>(DEFAULT_VAD_CONFIG);
  const [recordingProgress, setRecordingProgress] = useState<number>(0);
  const [isContinuousMode, setIsContinuousMode] = useState<boolean>(false);
  const [isRecordingInContinuousMode, setIsRecordingInContinuousMode] =
    useState<boolean>(false);

  const [pendingScreenshot, setPendingScreenshot] = useState<string | null>(null);
  const pendingScreenshotRef = useRef<string | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    capturingRef.current = capturing;
  }, [capturing]);

  useEffect(() => {
    pendingScreenshotRef.current = pendingScreenshot;
  }, [pendingScreenshot]);

  useEffect(() => {
    const savedVadConfig = safeLocalStorage.getItem("vad_config");
    if (savedVadConfig) {
      try {
        const parsed = JSON.parse(savedVadConfig);
        setVadConfig(parsed);
      } catch (err) {
        console.error("Failed to load VAD config:", err);
      }
    }
  }, []);

  const updateVadConfiguration = useCallback(async (config: VadConfig) => {
    try {
      setVadConfig(config);
      safeLocalStorage.setItem("vad_config", JSON.stringify(config));
      await invoke("update_vad_config", { config });
    } catch (err) {
      console.error("Failed to update VAD config:", err);
    }
  }, []);

  useEffect(() => {
    if (capturing) {
      setIsContinuousMode(!vadConfig.enabled);
      if (!vadConfig.enabled) {
        setIsRecordingInContinuousMode(false);
      }
    }
  }, [vadConfig.enabled, capturing]);

  const transcribeSegment = useCallback(
    async (
      audioBlob: Blob,
      source: "me" | "them",
      options?: { skipOnInterviewerTranscription?: boolean }
    ) => {
      const setSegmentProcessing =
        source === "me" ? setIsMicProcessing : setIsSystemProcessing;

      try {
        setSegmentProcessing(true);

        const sttPromise = transcribeWithFallback({
          selectedProvider: selectedSttProvider,
          audio: audioBlob,
          priority: "high",
          prompt: buildInitialPrompt(),
        });

        // Sidecar waits for the GPU lease up to 30s (busy-retry) and the
        // batch queue holds up to 40s; the race timeout must stay above the
        // server-side worst case so a legitimately queued request is not
        // abandoned mid-wait (its slot would still be parked server-side).
        const timeoutPromise = new Promise<string>((_, reject) => {
          setTimeout(
            () => reject(new Error("Speech transcription timed out (45s)")),
            45000
          );
        });

        const transcription = await Promise.race([sttPromise, timeoutPromise]);

        if (transcription.trim()) {
          const currentMicMode = micStateStore.getState().mode;
          if (source === "me" && currentMicMode === "IDLE") {
            // Ignore transcript if mic is idle
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

          if (source === "them" && !options?.skipOnInterviewerTranscription) {
            await onInterviewerTranscription(transcription);
          }
        } else {
          setError("Received empty transcription");
        }
      } catch (sttError: unknown) {
        console.error("STT Error:", sttError);
        const err = sttError as { message?: string };
        setError(err?.message || "Failed to transcribe audio");
        setIsPopoverOpen(true);
      } finally {
        setSegmentProcessing(false);
      }
    },
    [
      selectedSttProvider,
      appendLiveSegment,
      onInterviewerTranscription,
      setMyLastTranscription,
      setTheirLastTranscription,
      setError,
    ]
  );

  const handleSpeechDetectedRef = useRef<(base64Audio: string) => void>(() => {});
  useEffect(() => {
    handleSpeechDetectedRef.current = async (base64Audio: string) => {
      try {
        if (!capturingRef.current) return;
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const audioBlob = new Blob([bytes], { type: "audio/wav" });

        await transcribeSegment(audioBlob, "them");
      } catch (err) {
        console.warn("[system-audio]", err);
        setError("Failed to process speech");
      }
    };
  });

  useEffect(() => {
    let speechUnlisten: (() => void) | undefined;
    let cancelled = false;

    listen("speech-detected", (event) => {
      onInterviewerSpeechActivity?.();
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

    let partialUnlisten: (() => void) | undefined;
    let partialInFlight = false;
    const partialQueue: string[] = [];
    listen("speech-partial", (event) => {
      onInterviewerSpeechActivity?.();
      const b64 = event.payload as string;
      if (!b64 || !capturingRef.current) return;
      partialQueue.push(b64);
      if (partialInFlight) return;
      partialInFlight = true;

      void (async () => {
        while (partialQueue.length > 0) {
          // Only the freshest queued partial matters: older ones describe
          // audio the NEXT partial already includes (they are cumulative
          // buffers), and each batch costs a GPU lease wait. Transcribing a
          // backlog after a stall just burns the queue slot for nothing.
          while (partialQueue.length > 1) partialQueue.shift();
          const payload = partialQueue.shift()!;
          const binaryString = atob(payload);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: "audio/wav" });
          const usePluelyAPI = await shouldUsePluelyAPI();
          try {
            const prompt = buildInitialPrompt();
            const text = await transcribeWithFallback({
              provider: usePluelyAPI
                ? undefined
                : allSttProviders.find(
                    (p) => p.id === selectedSttProvider.provider
                  ),
              selectedProvider: selectedSttProvider,
              audio: blob,
              allowCloudFallback: false,
              priority: "low",
              prompt,
            });
            if (text && !isSttErrorMessage(text)) {
              const trimmed = text.trim();
              onInterviewerSpeechActivity?.();
              appendLiveSegment("them", trimmed, true);
            }
          } catch (err) {
            console.warn("[system-audio]", err);
          } finally {
            partialInFlight = false;
          }
        }
      })();
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          partialUnlisten = unlisten;
        }
      })
      .catch((err) => {
        console.warn("[system-audio]", err);
      });

    return () => {
      cancelled = true;
      if (speechUnlisten) speechUnlisten();
      if (partialUnlisten) partialUnlisten();
    };
  }, [allSttProviders, selectedSttProvider, appendLiveSegment, onInterviewerSpeechActivity, setError]);
  useEffect(() => {
    let progressUnlisten: (() => void) | undefined;
    let startUnlisten: (() => void) | undefined;
    let stopUnlisten: (() => void) | undefined;
    let errorUnlisten: (() => void) | undefined;
    let discardedUnlisten: (() => void) | undefined;

    const setupContinuousListeners = async () => {
      try {
        progressUnlisten = await listen("recording-progress", (event) => {
          const seconds = event.payload as number;
          setRecordingProgress(seconds);
        });

        startUnlisten = await listen("continuous-recording-start", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(true);
        });

        stopUnlisten = await listen("continuous-recording-stopped", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(false);
        });

        errorUnlisten = await listen("audio-encoding-error", (event) => {
          const errorMsg = event.payload as string;
          console.error("Audio encoding error:", errorMsg);
          setError(`Failed to process audio: ${errorMsg}`);
          setIsSystemProcessing(false);
          setIsAIProcessing(false);
          setIsRecordingInContinuousMode(false);
        });

        discardedUnlisten = await listen("speech-discarded", (event) => {
          const reason = event.payload as string;
          console.log("Speech discarded:", reason);
        });
      } catch (err) {
        console.error("Failed to setup continuous recording listeners:", err);
      }
    };

    setupContinuousListeners();

    return () => {
      if (progressUnlisten) progressUnlisten();
      if (startUnlisten) startUnlisten();
      if (stopUnlisten) stopUnlisten();
      if (errorUnlisten) errorUnlisten();
      if (discardedUnlisten) discardedUnlisten();
    };
  }, [setIsAIProcessing, setError]);

  const startContinuousRecording = useCallback(async () => {
    try {
      setRecordingProgress(0);
      setError("");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
      });
    } catch (err) {
      console.error("Failed to start continuous recording:", err);
      setError(`Failed to start recording: ${err}`);
    }
  }, [vadConfig, selectedAudioDevices.output.id, setError]);

  const ignoreContinuousRecording = useCallback(async () => {
    try {
      if (!isContinuousMode || !isRecordingInContinuousMode) return;

      await invoke<string>("stop_system_audio_capture");

      setRecordingProgress(0);
      setIsSystemProcessing(false);
      setIsRecordingInContinuousMode(false);
    } catch (err) {
      console.error("Failed to ignore recording:", err);
      setError(`Failed to ignore recording: ${err}`);
    }
  }, [isContinuousMode, isRecordingInContinuousMode, setError]);

  const manualStopAndSend = useCallback(async () => {
    try {
      if (!isContinuousMode) {
        console.warn("Not in continuous mode");
        return;
      }

      setIsSystemProcessing(true);
      await invoke("manual_stop_continuous");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to manually stop: ${errorMessage}`);
      setIsSystemProcessing(false);
      console.error("Manual stop error:", err);
    }
  }, [isContinuousMode, setError]);

  const stopMicVisualizerStream = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      setMicStream(null);
    }
  }, []);

  return {
    capturing,
    setCapturing,
    capturingRef,
    isMicProcessing,
    setIsMicProcessing,
    isSystemProcessing,
    setIsSystemProcessing,
    setupRequired,
    setSetupRequired,
    isPopoverOpen,
    setIsPopoverOpen,
    vadConfig,
    setVadConfig,
    updateVadConfiguration,
    recordingProgress,
    setRecordingProgress,
    isContinuousMode,
    setIsContinuousMode,
    isRecordingInContinuousMode,
    setIsRecordingInContinuousMode,
    pendingScreenshot,
    setPendingScreenshot,
    pendingScreenshotRef,
    micStream,
    setMicStream,
    micStreamRef,
    transcribeSegment,
    startContinuousRecording,
    ignoreContinuousRecording,
    manualStopAndSend,
    stopMicVisualizerStream,
  };
}
