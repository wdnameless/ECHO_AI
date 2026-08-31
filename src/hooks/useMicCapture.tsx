import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MicVAD } from "@ricky0123/vad-web";
import { floatArrayToWav } from "@/lib/utils";
import { StreamingLinearResampler, float32ToLittleEndian } from "@/lib/realtime-audio";

export interface UseMicCaptureOptions {
  microphoneDeviceId?: string;
  microphoneDeviceName?: string;
  onMicSegment: (audio: Blob) => void;
  onMicSpeechStart?: () => void;
  onMicSpeechStop?: () => void;
  onInterimTranscript?: (text: string) => void;
  onMicPartial?: (audio: Blob) => void;
  /**
   * Raw 16 kHz mono f32-LE frame (matches pluely-asr /v1/asr/stream
   * binary protocol) emitted while speech is ongoing. Used for WS
   * streaming; the 1s WAV batch path stays as the fallback.
   */
  onMicFrame?: (pcm: ArrayBuffer) => void;
}

interface MicVADBridgeProps {
  stream: MediaStream;
  onStateChange: (state: {
    listening: boolean;
    speaking: boolean;
    loading: boolean;
    errored: string | null;
  }) => void;
  onApiReady: (api: { start: () => void; stop: () => void }) => void;
  onMicSegment: (audio: Blob) => void;
  onMicSpeechStart?: () => void;
  onMicSpeechStop?: () => void;
  onInterimTranscript?: (text: string) => void;
  onMicPartial?: (audio: Blob) => void;
  onMicFrame?: (pcm: ArrayBuffer) => void;
}

// Bridge component that owns the VAD instance. It is mounted only once the
// MediaStream is available, so the VAD is always created with the correct
// device (the `stream` option is passed through unfiltered by vad-web, unlike
function MicVADBridge({
  stream,
  onStateChange,
  onApiReady,
  onMicSegment,
  onMicSpeechStart,
  onMicSpeechStop,
  onInterimTranscript,
  onMicPartial,
  onMicFrame,
}: MicVADBridgeProps) {
  const onMicSegmentRef = useRef(onMicSegment);
  const onMicSpeechStartRef = useRef(onMicSpeechStart);
  const onMicSpeechStopRef = useRef(onMicSpeechStop);
  const onStateChangeRef = useRef(onStateChange);
  const onApiReadyRef = useRef(onApiReady);
  const onInterimTranscriptRef = useRef(onInterimTranscript);
  const onMicPartialRef = useRef(onMicPartial);
  const onMicFrameRef = useRef(onMicFrame);

  useEffect(() => {
    onMicSegmentRef.current = onMicSegment;
    onMicSpeechStartRef.current = onMicSpeechStart;
    onMicSpeechStopRef.current = onMicSpeechStop;
    onStateChangeRef.current = onStateChange;
    onApiReadyRef.current = onApiReady;
    onInterimTranscriptRef.current = onInterimTranscript;
    onMicPartialRef.current = onMicPartial;
    onMicFrameRef.current = onMicFrame;
  }, [onMicSegment, onMicSpeechStart, onMicSpeechStop, onStateChange, onApiReady, onInterimTranscript, onMicPartial, onMicFrame]);

    const vadRef = useRef<MicVAD | null>(null);
    const listeningRef = useRef(false);
    const lastSpeakingRef = useRef(false);

    // Live mic partials: tap the raw stream (independent of VAD) and emit a
    // ~1s WAV while speech is ongoing, so the user's own words appear in the
    // feed in real time instead of only after the segment completes.
    let tapCtx: AudioContext | null = null;
    let speakingNow = false;
    let partialBuf: Float32Array[] = [];
    let partialSamples = 0;
    const cleanupTap: (() => void)[] = [];

  useEffect(() => {
    let cancelled = false;
    let vad: MicVAD | null = null;
    let recognition: any = null;
    let tapResampler: StreamingLinearResampler | null = null;

    // Web Speech API for real-time live word-by-word streaming
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = navigator.language?.startsWith("ru") ? "ru-RU" : "en-US";
        recognition.onresult = (event: any) => {
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            interim += transcript;
          }
          if (interim.trim()) {
            onInterimTranscriptRef.current?.(interim.trim());
          }
        };
        recognition.onerror = () => {};
      } catch {}
    }

    onStateChangeRef.current({
      listening: false,
      speaking: false,
      loading: true,
      errored: null,
    });

    MicVAD.new({
      stream,
      model: "legacy",
      // Explicit asset paths: the library derives them from
      // document.currentScript, which in the packaged Tauri build points at
      // /assets/ where the onnx/worklet files are NOT copied -> silent 404
      // -> the mic VAD never starts and transcription never fires.
      baseAssetPath: import.meta.env.BASE_URL,
      onnxWASMBasePath: import.meta.env.BASE_URL,
      onFrameProcessed: (probs) => {
        const w = window as unknown as {
          __micVadDiag?: { frames: number; maxProb: number; speechFrames: number };
        };
        if (!w.__micVadDiag) {
          w.__micVadDiag = { frames: 0, maxProb: 0, speechFrames: 0 };
        }
        const d = w.__micVadDiag;
        d.frames++;
        if (probs.isSpeech > d.maxProb) d.maxProb = probs.isSpeech;
        if (probs.isSpeech > 0.5) d.speechFrames++;
        if (d.frames % 100 === 0) {
          console.log(
            `[MICVAD] frames=${d.frames} maxProb=${d.maxProb.toFixed(3)} speechFrames=${d.speechFrames}`
          );
        }
        // Only push React state when the speaking flag actually flips -
        // avoids a full re-render on every audio frame (~30-100 fps).
        const speaking = probs.isSpeech > 0.6;
        speakingNow = speaking;
        if (speaking !== lastSpeakingRef.current) {
          lastSpeakingRef.current = speaking;
          onStateChangeRef.current({
            listening: listeningRef.current,
            speaking,
            loading: false,
            errored: null,
          });
        }
      },
      onSpeechStart: () => {
        onMicSpeechStartRef.current?.();
        try {
          recognition?.start();
        } catch {}
      },
      onSpeechEnd: (audio: Float32Array) => {
        onMicSpeechStopRef.current?.();
        const audioBlob = floatArrayToWav(audio, 16000, "wav");
        onMicSegmentRef.current(audioBlob);
        try {
          recognition?.stop();
        } catch {}
      },
    })
      .then((v) => {
        if (cancelled) {
          v.destroy();
          return;
        }
        vad = v;
        vadRef.current = v;
        onApiReadyRef.current({
          start: () => {
            tapResampler?.reset();
            partialBuf = [];
            partialSamples = 0;
            v.start();
            listeningRef.current = true;
            onStateChangeRef.current({
              listening: true,
              speaking: false,
              loading: false,
              errored: null,
            });
          },
          stop: () => {
            v.pause();
            tapResampler?.reset();
            partialBuf = [];
            partialSamples = 0;
            listeningRef.current = false;
            onStateChangeRef.current({
              listening: false,
              speaking: false,
              loading: false,
              errored: null,
            });
          },
        });
        onStateChangeRef.current({
          listening: false,
          speaking: false,
          loading: false,
          errored: null,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        onStateChangeRef.current({
          listening: false,
          speaking: false,
          loading: false,
          errored: e instanceof Error ? e.message : String(e),
        });
      });

    // Raw audio tap for live partials (runs alongside the VAD).
    try {
      const AudioCtx =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AudioCtx();
      tapCtx = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const sourceRate = ctx.sampleRate;
      const resampler = new StreamingLinearResampler(sourceRate);
      tapResampler = resampler;

      processor.onaudioprocess = (e: any) => {
        const input: Float32Array = e.inputBuffer.getChannelData(0);
        const out = resampler.process(input);
        if (out.length === 0) return;

        if (!speakingNow) {
          if (partialBuf.length) {
            partialBuf = [];
            partialSamples = 0;
          }
          return;
        }

        partialBuf.push(out);
        partialSamples += out.length;

        if (onMicFrameRef.current) {
          // WS STREAMING PATH: forward raw PCM as f32-LE 16kHz (sidecar
          // binary protocol). Accumulate 1s locally as before but also feed
          // every chunk so the server streams partials in real time.
          const bytes = float32ToLittleEndian(out);
          try {
            onMicFrameRef.current(bytes);
          } catch {}
        }

        // ~1s of accumulated speech → emit a live partial WAV (batch
        // fallback path when the mic WS is not open).
        if (partialSamples >= 16000) {
          const merged = new Float32Array(partialSamples);
          let off = 0;
          for (const chunk of partialBuf) {
            merged.set(chunk, off);
            off += chunk.length;
          }
          partialBuf = [];
          partialSamples = 0;
          try {
            onMicPartialRef.current?.(floatArrayToWav(merged, 16000, "wav"));
          } catch {}
        }
      };

      source.connect(processor);
      // ScriptProcessor only runs when connected to a destination; mute node.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(ctx.destination);

      cleanupTap.push(() => {
        resampler.reset();
        tapResampler = null;
        try {
          processor.disconnect();
          source.disconnect();
          mute.disconnect();
        } catch {}
      });
    } catch {}

    return () => {
      cancelled = true;
      vad?.destroy();
      vadRef.current = null;
      listeningRef.current = false;
      cleanupTap.forEach((fn) => fn());
      if (tapCtx) {
        tapCtx.close().catch(() => {});
        tapCtx = null;
      }
    };
  }, [stream]);

  return null;
}

export function useMicCapture({
  microphoneDeviceId,
  microphoneDeviceName,
  onMicSegment,
  onMicSpeechStart,
  onMicSpeechStop,
  onInterimTranscript,
  onMicPartial,
  onMicFrame,
}: UseMicCaptureOptions) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [streamKey, setStreamKey] = useState(0);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const vadApiRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const wantListeningRef = useRef(false);

  // Acquire the microphone stream ourselves so the correct device is used.
  // The stored device id is a WASAPI id which does not match WebRTC device
  // ids, so we map it by label via enumerateDevices first.
  useEffect(() => {
    let cancelled = false;
    let acquired: MediaStream | null = null;

    setLoading(true);
    setErrored(null);
    setListening(false);
    setSpeaking(false);
    vadApiRef.current = null;

    const acquire = async () => {
      try {
        let deviceId: string | undefined;
        if (microphoneDeviceId && microphoneDeviceId !== "default") {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioInputs = devices.filter((d) => d.kind === "audioinput");
          const byName = microphoneDeviceName
            ? audioInputs.find((d) => d.label === microphoneDeviceName)
            : undefined;
          const byId = audioInputs.find(
            (d) => d.deviceId === microphoneDeviceId
          );
          deviceId = (byName ?? byId)?.deviceId;
        }

        acquired = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            channelCount: 1,
            // AGC/echo cancellation/noise suppression are disabled: they
            // aggressively suppress quiet signals (e.g. a virtual cable feed),
            // which breaks VAD detection. The raw signal is what Silero wants.
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
          },
        });

        if (cancelled) {
          acquired.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = acquired;
        setStream(acquired);
        setStreamKey((k) => k + 1);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setLoading(false);
        setErrored(e instanceof Error ? e.message : String(e));
      }
    };

    acquire();

    return () => {
      cancelled = true;
      if (acquired) {
        acquired.getTracks().forEach((t) => t.stop());
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setStream(null);
    };
  }, [microphoneDeviceId, microphoneDeviceName]);

  const handleStateChange = useCallback(
    (state: {
      listening: boolean;
      speaking: boolean;
      loading: boolean;
      errored: string | null;
    }) => {
      setListening(state.listening);
      setSpeaking(state.speaking);
      setLoading(state.loading);
      setErrored(state.errored);
    },
    []
  );

  const handleApiReady = useCallback(
    (api: { start: () => void; stop: () => void }) => {
      vadApiRef.current = api;
      if (wantListeningRef.current) {
        api.start();
      }
    },
    []
  );

  const start = useCallback(() => {
    wantListeningRef.current = true;
    vadApiRef.current?.start();
  }, []);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    vadApiRef.current?.stop();
  }, []);

  const bridge: ReactNode = stream ? (
    <MicVADBridge
      key={streamKey}
      stream={stream}
      onStateChange={handleStateChange}
      onApiReady={handleApiReady}
      onMicSegment={onMicSegment}
      onMicSpeechStart={onMicSpeechStart}
      onMicSpeechStop={onMicSpeechStop}
      onInterimTranscript={onInterimTranscript}
      onMicPartial={onMicPartial}
      onMicFrame={onMicFrame}
    />
  ) : null;

  return {
    start,
    stop,
    micListening: listening,
    micSpeaking: speaking,
    micLoading: loading,
    micErrored: errored,
    stream,
    bridge,
  };
}
