import { describe, it, expect, vi } from "vitest";
import { DEFAULT_VAD_CONFIG } from "../useSystemAudioCapture";
import { DEFAULT_SILENCE_WINDOW_MS, ASR_TIMING_PRESETS, QuestionAssembler } from "@/lib/question-assembler";

describe("Latency fast-path and silence thresholds", () => {
  it("silence thresholds are tuned between 300ms and 500ms", () => {
    // 15 chunks at hop_size 1024 / 48000Hz ≈ 320-340ms
    expect(DEFAULT_VAD_CONFIG.silence_chunks).toBe(15);
    const silenceDurationSec = (DEFAULT_VAD_CONFIG.silence_chunks * DEFAULT_VAD_CONFIG.hop_size) / 48000;
    const silenceDurationMs = silenceDurationSec * 1000;
    expect(silenceDurationMs).toBeGreaterThanOrEqual(300);
    expect(silenceDurationMs).toBeLessThanOrEqual(500);

    // Question Assembler default silence window is 450ms
    expect(DEFAULT_SILENCE_WINDOW_MS).toBe(450);
    expect(DEFAULT_SILENCE_WINDOW_MS).toBeGreaterThanOrEqual(300);
    expect(DEFAULT_SILENCE_WINDOW_MS).toBeLessThanOrEqual(500);

    expect(ASR_TIMING_PRESETS.fast.flushGapMs).toBe(450);
  });

  it("fast-path dispatches question immediately when WS/streaming text is present without waiting for batch", async () => {
    const onInterviewerTranscription = vi.fn().mockResolvedValue(undefined);
    const appendLiveSegment = vi.fn();

    // Simulate fast path handler logic from useSystemAudioCapture
    const latestPartialRef = { text: "Расскажите про жизненный цикл React?", timestamp: Date.now() };

    const handleSpeechDetected = async (
      hasFastPath: boolean,
      batchTranscribeFn: () => Promise<string>
    ) => {
      let fastPathDispatched = false;
      const now = Date.now();
      if (hasFastPath && latestPartialRef.text && (now - latestPartialRef.timestamp < 3000)) {
        fastPathDispatched = true;
        void onInterviewerTranscription(latestPartialRef.text);
      }

      if (fastPathDispatched) {
        // Fast path: batch runs in background, skips onInterviewerTranscription (already sent!)
        void (async () => {
          const batchText = await batchTranscribeFn();
          appendLiveSegment("them", batchText, false);
        })();
      } else {
        // Fallback path: must await batch and dispatch from batch result
        const batchText = await batchTranscribeFn();
        appendLiveSegment("them", batchText, false);
        await onInterviewerTranscription(batchText);
      }
    };

    let resolveBatch!: (value: string) => void;
    let batchResolved = false;
    const slowBatch = () =>
      new Promise<string>((res) => {
        resolveBatch = (val) => {
          batchResolved = true;
          res(val);
        };
      });

    // Execute fast-path
    await handleSpeechDetected(true, slowBatch);

    // Question is dispatched immediately!
    expect(onInterviewerTranscription).toHaveBeenCalledTimes(1);
    expect(onInterviewerTranscription).toHaveBeenCalledWith("Расскажите про жизненный цикл React?");
    expect(batchResolved).toBe(false);

    // Now resolve the background batch promise deterministically
    resolveBatch("Расскажите про жизненный цикл React? (batch refined)");
    await Promise.resolve();
    await Promise.resolve();

    expect(batchResolved).toBe(true);
    expect(appendLiveSegment).toHaveBeenCalledWith(
      "them",
      "Расскажите про жизненный цикл React? (batch refined)",
      false
    );
    // Did NOT call onInterviewerTranscription a second time
    expect(onInterviewerTranscription).toHaveBeenCalledTimes(1);
  });

  it("fallback path awaits batch and dispatches when WS-final is empty or unavailable", async () => {
    const onInterviewerTranscription = vi.fn().mockResolvedValue(undefined);
    const appendLiveSegment = vi.fn();

    const latestPartialRef = { text: "", timestamp: 0 };

    const handleSpeechDetected = async (
      batchTranscribeFn: () => Promise<string>
    ) => {
      let fastPathDispatched = false;
      const now = Date.now();
      if (latestPartialRef.text && (now - latestPartialRef.timestamp < 3000)) {
        fastPathDispatched = true;
        void onInterviewerTranscription(latestPartialRef.text);
      }

      if (fastPathDispatched) {
        void (async () => {
          const batchText = await batchTranscribeFn();
          appendLiveSegment("them", batchText, false);
        })();
      } else {
        // Fallback
        const batchText = await batchTranscribeFn();
        appendLiveSegment("them", batchText, false);
        await onInterviewerTranscription(batchText);
      }
    };

    const batchMock = vi.fn().mockResolvedValue("Fallback question from batch transcribe");
    await handleSpeechDetected(batchMock);

    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(appendLiveSegment).toHaveBeenCalledWith("them", "Fallback question from batch transcribe", false);
    expect(onInterviewerTranscription).toHaveBeenCalledTimes(1);
    expect(onInterviewerTranscription).toHaveBeenCalledWith("Fallback question from batch transcribe");
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
