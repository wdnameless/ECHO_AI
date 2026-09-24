import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { safeLocalStorage } from "@/lib";
import { buildInitialPrompt } from "@/lib/vocab";
import { transcribeWithFallback, isSttErrorMessage } from "@/lib/functions";
import { recordPartialLatency, recordFirstText } from "@/lib/metrics";
import { micStateStore } from "@/stores/mic-state";
import { useThemWsStreaming } from "./useThemWsStreaming";
import { getAsrCapabilities } from "@/lib/asr-capabilities";
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
 * Cadence of the live re-transcription used when the loaded model cannot
 * stream. Measured on Parakeet: one HTTP call costs 44-58ms regardless of clip
 * length, so ~600ms keeps the feed visibly live without saturating the engine.
 */
const LIVE_BATCH_MS = 600;

/**
 * Hard limit on how long ONE utterance may grow before the live pass keeps only
 * its tail, in samples at 16 kHz.
 *
 * Normal speech is cut into utterances by the VAD well before this (a pause of
 * ~0.3s ends one), so the limit only catches a pathological minutes-long
 * monologue. Cost is linear in clip length (measured: 90ms at 2.5s, 806ms at
 * 20s), and the end-of-speech batch pass always covers the whole utterance, so
 * trimming the live preview there is safe.
 */
const LIVE_MAX_UTTERANCE_MS = 20 * 16000;

/**
 * Wraps 16-bit mono PCM at 16 kHz in a WAV container.
 *
 * The engine rejects a header whose `data` size does not match the payload
 * ("invalid WAV: failed to read int samples"), so the header is rebuilt for
 * every growing utterance instead of carrying the original clip's sizes.
 */
function encodeWav16kMono(pcm: Int16Array): ArrayBuffer {
  const dataLen = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataLen, true);
  new Int16Array(buf, 44).set(pcm);
  return buf;
}

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
  onInterviewerTranscription: (text: string, pauseBeforeMs?: number) => Promise<void>;
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
  /** Text accumulated from streamed chunks, awaiting the real end of speech. */
  const rolledTextRef = useRef("");
  /** True when the last final came from the end-of-speech flush, not a roll. */
  const utteranceEndedRef = useRef(false);
  /**
   * Dispatches the accumulated monologue to the question assembler.
   *
   * Reached from the final frame when it arrives, and from a safety timer when
   * it does not: the rolling flush closes the socket exactly when speech ends,
   * so the end-of-speech `finalize` can be lost — the feed kept growing in
   * italics and the AI never answered because the question was never emitted.
   */
  const flushUtteranceRef = useRef<() => void>(() => {});
  /** Fires if the end-of-speech final never reaches us. */
  const flushSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Whether the loaded model implements the streaming protocol. Non-streamable
   * models (Parakeet) are served by the batch path; the socket is never opened
   * for them, so no utterance is wasted on a request the engine rejects.
   */
  const streamingModelRef = useRef(false);
  /** Raw PCM frames of the utterance being re-transcribed by the live batch. */
  const livePcmRef = useRef<Uint8Array[]>([]);
  /** Pending cadence timer for the live batch re-transcription. */
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Last text produced by the live batch, so a re-transcription that returns
   * less than the previous one never makes the line shrink.
   */
  const liveTextRef = useRef("");
  /** When the current utterance's first audio frame arrived, for first-text. */
  const utteranceStartedAtRef = useRef<number | null>(null);
  /** True while a live pass is in flight, so passes never overlap. */
  const liveBusyRef = useRef(false);

  useEffect(() => {
    capturingRef.current = capturing;
    // Resolve the model's capabilities when capture starts, not on the first
    // `speech-start`: the microphone channel asks `canStream()` from its own VAD,
    // and if the candidate spoke before the interviewer, the flag was still its
    // initial `false` — the stream was skipped for a model that supports it and
    // that utterance went through the slower batch path.
    if (capturing) {
      void (async () => {
        const caps = await getAsrCapabilities();
        streamingModelRef.current = caps.streaming;
      })();
    }
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

        const batchStarted = Date.now();

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
        // The timer shows what a finished utterance costs end to end.
        recordPartialLatency(Date.now() - batchStarted);

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

          if (source === "them") {
            // The authoritative pass has consumed this utterance: drop the live
            // preview state so the next one starts clean, and let the dedupe in
            // appendLiveSegment replace the preview row with this text.
            livePcmRef.current = [];
            liveTextRef.current = "";
            utteranceStartedAtRef.current = null;
          }

          if (source === "them" && !options?.skipOnInterviewerTranscription) {
            await onInterviewerTranscription(transcription, pauseBeforeUtteranceRef.current);
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

  /** When the VAD last reported that an utterance had ended (wall clock). */
  const lastAudioSpeechEndRef = useRef<number | null>(null);
  /**
   * Silence in the AUDIO before the utterance currently being transcribed.
   *
   * The recogniser returns text ~1.1s after the speech that produced it, so the
   * interval between two TEXT arrivals equals the second utterance's spoken
   * duration plus the pause between them — a 3s clause after a 300ms pause looks
   * like a 3.3s silence and was treated as a new question, discarding the text
   * already transcribed. Measured between the VAD's own events instead, the
   * value is the real pause: the VAD needs ~280ms of silence to close an
   * utterance at all, so a mid-sentence breath measures near zero while a
   * finished question measures hundreds of milliseconds.
   */
  const pauseBeforeUtteranceRef = useRef(0);

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

      // A transport chunk from a rolling flush: shown live and accumulated,
      // never dispatched on its own — a 1.5s chunk looks like a "pause" to the
      // question assembler and the AI would answer a half-formed question.
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

  /**
   * Sends the accumulated utterance to the question assembler once, and clears
   * the accumulation so nothing is dispatched twice.
   */
  flushUtteranceRef.current = () => {
    if (flushSafetyTimerRef.current) {
      clearTimeout(flushSafetyTimerRef.current);
      flushSafetyTimerRef.current = null;
    }
    const whole = rolledTextRef.current.trim();
    rolledTextRef.current = "";
    utteranceEndedRef.current = false;
    if (!whole) return;
    setTheirLastTranscription(whole);
    appendLiveSegment("them", whole);
    void onInterviewerTranscription(whole);
  };

  /**
   * Re-transcribes the growing utterance over HTTP on a fixed cadence.
   *
   * Used when the loaded model has no streaming protocol. Measured on Parakeet:
   * one call costs 44-58ms whatever the clip length, so re-running it four
   * times a second is cheaper than the streaming model's single late answer —
   * and it is what makes live text possible on a non-streamable model.
   */
  const runLiveBatch = useCallback(async () => {
    if (!capturingRef.current) return;
    // One pass at a time: a pass can take longer than the cadence on a busy
    // engine, and overlapping passes queue behind each other — their reported
    // latency would then be queueing time, not the live delay.
    if (liveBusyRef.current) return;
    liveBusyRef.current = true;
    // Take the frames WITHOUT putting them back: the previous `splice` followed
    // by a re-assign kept the whole utterance in memory, so every pass
    // re-transcribed a longer clip and cost grew with the monologue (measured:
    // 90ms at 2.5s of audio, 1.5s at 40s — instead of a flat ~50ms).
    const frames = livePcmRef.current;
    livePcmRef.current = [];
    if (frames.length === 0) {
      liveBusyRef.current = false;
      return;
    }

    // Finished utterances are transcribed whole and dropped, so the frames left
    // here belong to the utterance still being spoken. A bounded window would
    // silently cut the opening words off a long monologue; the cap is therefore
    // expressed as a limit on how long ONE utterance may run (below), not on how
    // much of it reaches the recogniser.
    let sampleCount = 0;
    for (const f of frames) sampleCount += f.length;
    const maxSamples = LIVE_MAX_UTTERANCE_MS;
    let skipBytes = 0;
    if (sampleCount / 4 > maxSamples) {
      // A pathological monologue (minutes without a pause): keep the tail, which
      // is what the live line is for, and let the end-of-speech batch pass cover
      // the whole thing.
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
    const wav = encodeWav16kMono(pcm.subarray(0, written));
    const started = Date.now();
    try {
      const text = await transcribeWithFallback({
        selectedProvider: selectedSttProvider,
        audio: new Blob([wav], { type: "audio/wav" }),
        priority: "high",
        prompt: buildInitialPrompt(),
      });
      const clean = text.trim();
      if (!clean || isSttErrorMessage(clean)) return;
      recordPartialLatency(Date.now() - started);
      // First text of this utterance: the delay the user actually perceives.
      if (utteranceStartedAtRef.current !== null && liveTextRef.current === "") {
        recordFirstText(Date.now() - utteranceStartedAtRef.current);
      }
      // Never let a shorter reading of the same audio shrink the live line.
      if (clean.length >= liveTextRef.current.length) {
        liveTextRef.current = clean;
        appendLiveSegment("them", clean, true);
      }
    } catch {
      // A dropped live pass is not an error: the next one covers the audio.
    } finally {
      liveBusyRef.current = false;
    }
  }, [appendLiveSegment, selectedSttProvider]);

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

      if (streamingModelRef.current) {
        themWsRef.current.feedFrame(bytes.buffer as ArrayBuffer);
        return;
      }
      // Non-streamable model: keep the raw PCM of the growing utterance and
      // re-transcribe it on a cadence. Measured on Parakeet: 44-58ms per call
      // regardless of clip length, so a ~600ms cadence gives live text at a
      // fraction of the cost of the streaming model's late 1.1-12s results.
      livePcmRef.current.push(new Uint8Array(bytes.buffer as ArrayBuffer));
      if (liveTimerRef.current === null) {
        liveTimerRef.current = setTimeout(() => {
          liveTimerRef.current = null;
          void runLiveBatch();
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

  // One socket per utterance, as the sidecar's protocol demands: it CLOSES the
  // stream as soon as it answers a `finalize` (verified: state CLOSED within
  // 2s), so a session-scoped socket churned reconnects and lost the audio that
  // arrived while it was down. Frames that arrive during the handshake are
  // buffered and flushed on open, so nothing is dropped in between.
  //
  // The socket is opened only when the loaded model implements the streaming
  // protocol. A fast model may not: Parakeet answers a stream request with
  // `stream begin failed: not implemented by this model`, so opening one wasted
  // the whole utterance. Those models are served by the batch path instead,
  // which is also the faster one for them (measured ~64ms per utterance).
  useEffect(() => {
    let startUnlisten: (() => void) | undefined;
    let cancellable = false;

    listen("speech-start", () => {
      if (!capturingRef.current) return;
      // A new utterance starts empty: the previous monologue was already
      // dispatched (or dropped) when its speech ended.
      //
      // The pause that closed the previous utterance is measured from the VAD
      // event, not from the previous text: the recogniser returns text ~1.1s
      // after the speech, so arrival intervals reflect how long the second
      // clause was spoken, not the silence between the two.
      if (lastAudioSpeechEndRef.current !== null) {
        pauseBeforeUtteranceRef.current = Math.max(
          0,
          Date.now() - lastAudioSpeechEndRef.current
        );
      }
      rolledTextRef.current = "";
      utteranceEndedRef.current = false;
      livePcmRef.current = [];
      liveTextRef.current = "";
      utteranceStartedAtRef.current = Date.now();
      void (async () => {
        const caps = await getAsrCapabilities();
        streamingModelRef.current = caps.streaming;
        if (!caps.streaming || !capturingRef.current) return;
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
  }, [capturingRef]);

  useEffect(() => {
    if (!capturing) {
      themWsRef.current.finalizeAndClose();
      // Stop the live cadence with the capture: a pending timer used to fire
      // once more after leaving meeting mode and post a transcription for audio
      // that was no longer being recorded.
      if (liveTimerRef.current !== null) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }
      livePcmRef.current = [];
      liveTextRef.current = "";
      utteranceStartedAtRef.current = null;
    }
  }, [capturing]);

  useEffect(() => {
    let speechUnlisten: (() => void) | undefined;
    let cancelled = false;

    listen("speech-detected", (event) => {
      // End of the interviewer's utterance. Which path finishes it depends on
      // the loaded model: a streamable one owns the socket and is asked to
      // flush; a non-streamable one (Parakeet) never had a socket, so the WAV
      // the capture attached to this event is transcribed over HTTP — measured
      // at ~64ms, the fastest path available.
      //
      // This event marks the true end of speech in the audio, so the pause
      // before the next utterance is measured from here rather than from the
      // text that this transcription will produce much later.
      lastAudioSpeechEndRef.current = Date.now();
      if (
        streamingModelRef.current &&
        (themWsRef.current.isStreaming() ||
          themWsRef.current.hasProducedText() ||
          micStreamOwnsModelRef.current)
      ) {
        onInterviewerSpeechActivity?.();
        utteranceEndedRef.current = true;
        // If the final frame is lost (the socket can close as speech ends),
        // dispatch the accumulated monologue anyway — otherwise the feed keeps
        // growing in italics and the AI is never asked anything.
        if (flushSafetyTimerRef.current) clearTimeout(flushSafetyTimerRef.current);
        flushSafetyTimerRef.current = setTimeout(() => {
          flushSafetyTimerRef.current = null;
          flushUtteranceRef.current();
        }, 1200);
        themWsRef.current.finalizeUtterance();
        return;
      }
      // Batch path: the model cannot stream. The live cadence produced a
      // PREVIEW that is up to one cadence (~600ms) behind, so its text can miss
      // the closing words of the utterance — often the actual question. The
      // end-of-speech pass over the whole utterance is therefore authoritative:
      // it replaces the preview and is what the question assembler and the AI
      // receive. Clearing the frames before it (as this used to) threw away the
      // tail before anything had read it.
      onInterviewerSpeechActivity?.();
      if (liveTimerRef.current !== null) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }
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
    /**
     * True when the loaded model implements the streaming protocol.
     *
     * The microphone channel has the same constraint as the interviewer one: a
     * non-streamable model (Parakeet) refuses `/v1/asr/stream`, so opening a
     * socket for it wasted the utterance and dropped the cached port. The mic
     * path is fed by the webview VAD and must ask before connecting.
     */
    canStream: useCallback(() => streamingModelRef.current, []),
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
