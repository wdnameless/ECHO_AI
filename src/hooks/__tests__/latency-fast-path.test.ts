import { describe, it, expect } from "vitest";
import { DEFAULT_VAD_CONFIG } from "../useSystemAudioCapture";
import { DEFAULT_SILENCE_WINDOW_MS, ASR_TIMING_PRESETS, QuestionAssembler } from "@/lib/question-assembler";

describe("Latency fast-path and silence thresholds", () => {
  it("silence thresholds are tuned for natural speech pauses", () => {
    // 12 chunks at hop_size 1024 / 48000Hz ≈ 260-280ms. The stream socket is
    // session-scoped, so a short window no longer churns the connection; it
    // only decides how soon an utterance is flushed to the AI.
    expect(DEFAULT_VAD_CONFIG.silence_chunks).toBe(12);
    const silenceDurationSec = (DEFAULT_VAD_CONFIG.silence_chunks * DEFAULT_VAD_CONFIG.hop_size) / 48000;
    const silenceDurationMs = silenceDurationSec * 1000;
    expect(silenceDurationMs).toBeGreaterThanOrEqual(200);
    expect(silenceDurationMs).toBeLessThanOrEqual(400);

    // Question Assembler default silence window is 450ms
    expect(DEFAULT_SILENCE_WINDOW_MS).toBe(450);
    expect(DEFAULT_SILENCE_WINDOW_MS).toBeGreaterThanOrEqual(300);
    expect(DEFAULT_SILENCE_WINDOW_MS).toBeLessThanOrEqual(1000);

    expect(ASR_TIMING_PRESETS.fast.flushGapMs).toBe(450);
  });

  it("does not prematurely flush when utterance ends with continuation punctuation", () => {
    const assembler = new QuestionAssembler({ mode: "fast" });
    const now = Date.now();

    assembler.push({ text: "В проекте использовался TypeScript,", timestamp: now, source: "them" });
    const res = assembler.flush();

    expect(res?.kind).toBe("pending");
    expect(assembler.current?.text).toBe("В проекте использовался TypeScript,");
  });
});
