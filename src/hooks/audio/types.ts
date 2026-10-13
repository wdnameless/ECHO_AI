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
 * Cadence of the live re-transcription used when the loaded model cannot stream.
 */
export const LIVE_BATCH_MS = 250;

/**
 * Hard limit on how long ONE utterance may grow before the live pass keeps only
 * its tail, in samples at 16 kHz.
 */
export const LIVE_MAX_UTTERANCE_MS = 20 * 16000;

/**
 * Safety timeout before falling back if final stream frame is dropped.
 * Reduced from 1200ms to 350ms per R05.
 */
export const FLUSH_SAFETY_TIMEOUT_MS = 350;

/**
 * Decodes speech-frame event payload from Tauri IPC.
 * Supports binary IPC (Uint8Array, ArrayBuffer, Vec<u8> as number[])
 * as well as legacy base64 strings.
 */
export function decodeSpeechFramePayload(payload: unknown): Uint8Array | null {
  if (!payload) return null;
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (Array.isArray(payload)) return new Uint8Array(payload);
  if (typeof payload === "string") {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return null;
}

/**
 * Whether a PCM buffer holds enough energy to be worth transcribing.
 */
export function hasSpeechEnergy(pcm: Int16Array, config: VadConfig): boolean {
  if (pcm.length === 0) return false;
  // ~100ms at 16 kHz, and never longer than the buffer itself, so a short
  // segment is measured whole in a single pass.
  const windowSize = Math.min(1600, pcm.length);
  for (let start = 0; start < pcm.length; start += windowSize) {
    const end = Math.min(start + windowSize, pcm.length);
    let sumsq = 0;
    for (let i = start; i < end; i++) {
      // Normalise back to the -1..1 scale the threshold is expressed in.
      const v = pcm[i] / 32768;
      sumsq += v * v;
    }
    if (Math.sqrt(sumsq / (end - start)) >= config.noise_gate_threshold) {
      return true;
    }
  }
  return false;
}

/**
 * Wraps 16-bit mono PCM at 16 kHz in a WAV container.
 */
export function encodeWav16kMono(pcm: Int16Array): ArrayBuffer {
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

export interface UseSystemAudioCaptureProps {
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
