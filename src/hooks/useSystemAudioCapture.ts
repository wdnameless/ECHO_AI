import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { safeLocalStorage } from "@/lib";
import { buildInitialPrompt } from "@/lib/vocab";
import { transcribeWithFallback } from "@/lib/functions";
import { micStateStore } from "@/stores/mic-state";
import { useThemWsStreaming } from "./useThemWsStreaming";
import { withNoStream } from "@/lib/asr-gate";

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
  silence_chunks: 12, // ~0.28s. Measured: a 1-3s utterance returns text in ~1.1s, while a long one waits ~12s (the recogniser re-runs its language check over the whole buffer). Short utterances are faster here; the question assembler merges them.
  min_speech_chunks: 7, // ~0.16s — 12 discarded real speech as noise and no utterance finished
  pre_speech_chunks: 12,
  noise_gate_threshold: 0.003,
  max_recording_duration_secs: 180,
};

/**
 * How long a continuous monologue may run before the stream is flushed and
 * reopened. Measured on the local engine: a 1-3s chunk returns text in ~1.1s,
 * while a long utterance waits ~12s for the language check to re-run over the
 * whole buffer. ~1.5s keeps the first line of a long answer fast.
 */
const SPEECH_ROLL_MS = 1500;

interface UseSystemAudioCaptureProps {
  selectedAudioDevices: {
    input: { id: string; name: string };
    output: { id: string; name: string };
  };
  selectedSttProvider: {
    provider: string;
    variables: Record<string, string>;
  };
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
  /**
   * True while the candidate's microphone owns the single-model stream. The
   * interviewer channel must not start an HTTP transcription in that window:
   * the sidecar answers "model busy: a stream is active on this model".
   */
  const micStreamOwnsModelRef = useRef(false);
  /**
   * Rolling flush timer for the interviewer stream. Long speech is pushed to
   * the recogniser in ~1.5s slices, because a long buffer costs ~12s while a
   * short one returns in ~1.1s (measured).
   */
  const rollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Text accumulated from rolled chunks, awaiting the real end of speech. */
  const rolledTextRef = useRef("");
  /** True when the last final came from the end-of-speech flush, not a roll. */
  const utteranceEndedRef = useRef(false);

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

        // A stream holds the model; the sidecar answers 500 "model busy" for
        // HTTP transcription while one is open, so wait for it to finish.
        const sttPromise = withNoStream(() =>
          transcribeWithFallback({
            selectedProvider: selectedSttProvider,
            audio: audioBlob,
            priority: "high",
            prompt: buildInitialPrompt(),
          })
        );

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

  // Live channel: Rust emits ~250 ms of fresh PCM per `speech-frame` while the
  // interviewer speaks, and this forwards it to the sidecar's streaming socket.
  // Without it the only live path re-transcribed the whole utterance once a
  // second over HTTP - a second of delay per partial, and every result repeating
  // the text that was already on screen.
  const themWs = useThemWsStreaming({
    capturingRef,
    onPartialTranscript: (text) => {
      onInterviewerSpeechActivity?.();
      appendLiveSegment("them", text, true);
    },
    onFinalTranscript: (text) => {
      onInterviewerSpeechActivity?.();
      const chunk = text.trim();
      if (!chunk) return;

      if (utteranceEndedRef.current) {
        // The speaker really stopped: this is the end of the utterance, so the
        // whole monologue goes to the question assembler at once and may be
        // answered. Feeding every rolled chunk to the assembler instead made it
        // see a 1.5s "pause" (longer than its 400ms early-emit gate) and the AI
        // answered a fragment while the interviewer was still talking.
        utteranceEndedRef.current = false;
        const whole = [rolledTextRef.current, chunk].filter(Boolean).join(" ").trim();
        rolledTextRef.current = "";
        setTheirLastTranscription(whole);
        appendLiveSegment("them", whole);
        void onInterviewerTranscription(whole);
        return;
      }

      // A transport chunk from a rolling flush: shown live, accumulated for the
      // question, never dispatched on its own.
      rolledTextRef.current = [rolledTextRef.current, chunk].filter(Boolean).join(" ");
      appendLiveSegment("them", rolledTextRef.current, true);
    },
  });
  const themWsRef = useRef(themWs);
  themWsRef.current = themWs;

  useEffect(() => {
    let frameUnlisten: (() => void) | undefined;
    let cancelled = false;

    listen<string>("speech-frame", (event) => {
      if (!capturingRef.current) return;
      const b64 = event.payload;
      if (!b64) return;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      themWsRef.current.feedFrame(bytes.buffer as ArrayBuffer);
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

  // One socket per utterance, as the sidecar's protocol demands: it CLOSES the
  // stream as soon as it answers a `finalize` (verified: state CLOSED within
  // 2s), so a session-scoped socket churned reconnects and lost the audio that
  // arrived while it was down. Frames that arrive during the handshake are
  // buffered and flushed on open, so nothing is dropped in between.
  //
  // Speech is CHUNKED rather than left to run: measured on this engine a 1-3s
  // chunk returns text in ~1.1s, while a long utterance waits ~12s for the
  // language check to re-run over the whole buffer. A live interview needs the
  // first line fast, and the question assembler joins the chunks afterwards.
  useEffect(() => {
    let startUnlisten: (() => void) | undefined;
    let cancellable = false;

    listen("speech-start", () => {
      if (!capturingRef.current) return;
      themWsRef.current.beginUtterance();
      themWsRef.current.start();
      // A new utterance starts empty: the previous monologue was already
      // dispatched (or dropped) when its speech ended.
      rolledTextRef.current = "";
      utteranceEndedRef.current = false;

      // Roll the stream while the speaker keeps going, so text lands in
      // ~1.5s slices instead of one late block at the end of a monologue.
      if (rollTimerRef.current) {
        clearTimeout(rollTimerRef.current);
        rollTimerRef.current = null;
      }
      const scheduleRoll = () => {
        rollTimerRef.current = setTimeout(() => {
          rollTimerRef.current = null;
          if (!capturingRef.current) return;
          themWsRef.current.rollUtterance();
          scheduleRoll();
        }, SPEECH_ROLL_MS);
      };
      scheduleRoll();
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
      if (rollTimerRef.current) {
        clearTimeout(rollTimerRef.current);
        rollTimerRef.current = null;
      }
    };
  }, [capturingRef]);

  useEffect(() => {
    if (!capturing) {
      themWsRef.current.finalizeAndClose();
    }
  }, [capturing]);

  useEffect(() => {
    let speechUnlisten: (() => void) | undefined;
    let cancelled = false;

    listen("speech-detected", (event) => {
      // End of the interviewer's utterance: ask for the final text, which is
      // the only frame the question assembler and the AI pipeline consume. The
      // sidecar closes the socket right after answering it.
      if (
        themWsRef.current.isStreaming() ||
        themWsRef.current.hasProducedText() ||
        micStreamOwnsModelRef.current
      ) {
        onInterviewerSpeechActivity?.();
        utteranceEndedRef.current = true;
        if (rollTimerRef.current) {
          clearTimeout(rollTimerRef.current);
          rollTimerRef.current = null;
        }
        themWsRef.current.finalizeUtterance();
        return;
      }
      // No live stream and the microphone is not holding the model: the batch
      // call is the last resort. It used to fire while the mic stream owned the
      // model and surfaced "model busy: a stream is active on this model".
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

    return () => {
      cancelled = true;
      if (speechUnlisten) speechUnlisten();
    };
  }, [appendLiveSegment, onInterviewerSpeechActivity, setError]);
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
    /** Hands the single-model stream to the microphone channel. */
    yieldThemToMic: useCallback(() => {
      micStreamOwnsModelRef.current = true;
      themWsRef.current.finalizeAndClose();
    }, []),
    /** Takes the stream back once the microphone utterance ended. */
    releaseMicModelOwnership: useCallback(() => {
      micStreamOwnsModelRef.current = false;
    }, []),
    startContinuousRecording,
    ignoreContinuousRecording,
    manualStopAndSend,
    stopMicVisualizerStream,
  };
}
