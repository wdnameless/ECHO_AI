import { describe, it, expect } from "vitest";
import { hasSpeechEnergy, DEFAULT_VAD_CONFIG } from "../useSystemAudioCapture";
import type { VadConfig } from "../useSystemAudioCapture";

/**
 * The speech floor decides whether audio is worth transcribing.
 *
 * It exists because the engine INVENTS a word for silence rather than returning
 * empty: measured with the app's own settings, 300ms of pure digital silence
 * came back as "Yeah." on 12 consecutive runs, and the live feed showed that
 * word as the interviewer's line. The frames here start at detected speech, but
 * the live pass also carries the trailing silence before the end-of-speech
 * threshold — so a segment can reach the model with no voice in it.
 *
 * Verified against the engine that the floor lands where it must: amplitude
 * 0.001 is below it (and the engine returned ""), amplitude 0.003 is at it.
 */

const config: VadConfig = { ...DEFAULT_VAD_CONFIG, noise_gate_threshold: 0.003 };

/** Constant-amplitude PCM, the same scale the app builds for the WAV. */
const pcm = (samples: number, amplitude: number) => {
  const out = new Int16Array(samples);
  for (let i = 0; i < samples; i++) out[i] = Math.round(amplitude * 32767);
  return out;
};

describe("speech floor", () => {
  it("rejects digital silence — the input that made the engine say «Yeah.»", () => {
    expect(hasSpeechEnergy(pcm(4800, 0), config)).toBe(false);
  });

  it("rejects room noise below the configured floor", () => {
    expect(hasSpeechEnergy(pcm(4800, 0.001), config)).toBe(false);
  });

  it("accepts speech above the floor", () => {
    expect(hasSpeechEnergy(pcm(4800, 0.02), config)).toBe(true);
  });

  it("keeps quiet speech followed by a long silence", () => {
    // 0.16s of speech then 3s of silence: a whole-buffer average is diluted
    // below the floor and would drop the words; the loudest window keeps them.
    const speech = pcm(2560, 0.02);
    const tail = pcm(48000, 0);
    const mixed = new Int16Array(speech.length + tail.length);
    mixed.set(speech, 0);
    mixed.set(tail, speech.length);
    expect(hasSpeechEnergy(mixed, config)).toBe(true);
  });

  it("measures a segment shorter than one window whole", () => {
    expect(hasSpeechEnergy(pcm(160, 0.02), config)).toBe(true);
    expect(hasSpeechEnergy(pcm(160, 0), config)).toBe(false);
  });

  it("treats an empty buffer as nothing to transcribe", () => {
    expect(hasSpeechEnergy(new Int16Array(0), config)).toBe(false);
  });

  it("follows the configured noise gate, so tuning it tunes this", () => {
    // The knob is exposed in the settings panel; a higher floor rejects audio
    // the default would pass.
    const audio = pcm(4800, 0.004);
    expect(hasSpeechEnergy(audio, config)).toBe(true);
    expect(
      hasSpeechEnergy(audio, { ...config, noise_gate_threshold: 0.05 })
    ).toBe(false);
  });
});
