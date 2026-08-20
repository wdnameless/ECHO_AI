import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MicVAD } from "@ricky0123/vad-web";
import { floatArrayToWav } from "@/lib/utils";

export interface UseMicCaptureOptions {
  microphoneDeviceId?: string;
  microphoneDeviceName?: string;
  onMicSegment: (audio: Blob) => void;
  onMicSpeechStart?: () => void;
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
}

// Bridge component that owns the VAD instance. It is mounted only once the
// MediaStream is available, so the VAD is always created with the correct
// device (the `stream` option is passed through unfiltered by vad-web, unlike
// `additionalAudioConstraints` which is dropped by vad-react's useOptions).
function MicVADBridge({
  stream,
  onStateChange,
  onApiReady,
  onMicSegment,
  onMicSpeechStart,
}: MicVADBridgeProps) {
  const onMicSegmentRef = useRef(onMicSegment);
  const onMicSpeechStartRef = useRef(onMicSpeechStart);
  const onStateChangeRef = useRef(onStateChange);
  const onApiReadyRef = useRef(onApiReady);

  useEffect(() => {
    onMicSegmentRef.current = onMicSegment;
    onMicSpeechStartRef.current = onMicSpeechStart;
    onStateChangeRef.current = onStateChange;
    onApiReadyRef.current = onApiReady;
  }, [onMicSegment, onMicSpeechStart, onStateChange, onApiReady]);

  const vadRef = useRef<MicVAD | null>(null);
  const listeningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let vad: MicVAD | null = null;

    onStateChangeRef.current({
      listening: false,
      speaking: false,
      loading: true,
      errored: null,
    });

    MicVAD.new({
      stream,
      model: "legacy",
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
        onStateChangeRef.current({
          listening: listeningRef.current,
          speaking: probs.isSpeech > 0.6,
          loading: false,
          errored: null,
        });
      },
      onSpeechStart: () => {
        onMicSpeechStartRef.current?.();
      },
      onSpeechEnd: (audio: Float32Array) => {
        const audioBlob = floatArrayToWav(audio, 16000, "wav");
        onMicSegmentRef.current(audioBlob);
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

    return () => {
      cancelled = true;
      vad?.destroy();
      vadRef.current = null;
      listeningRef.current = false;
    };
  }, [stream]);

  return null;
}

export function useMicCapture({
  microphoneDeviceId,
  microphoneDeviceName,
  onMicSegment,
  onMicSpeechStart,
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
