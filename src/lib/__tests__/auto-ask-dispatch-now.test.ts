import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AutoAskManager } from "../auto-ask";

/**
 * `dispatchNow` sends a question whose silence the assembler has already
 * confirmed, so it must NOT hold it for a second window — that double gate was
 * measured at 450ms + 1000ms before the request even started. It must still
 * apply the same eligibility rules, or a "ммм" would reach the AI.
 */
describe("AutoAskManager.dispatchNow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const mk = (onDispatch: (t: string) => void, mode: "auto" | "manual" = "auto", busy = false) =>
    new AutoAskManager({
      getConfig: () => ({ enabled: true, mode, silenceDurationMs: 1000 }),
      isAIProcessing: () => busy,
      onDispatch,
    });

  it("dispatches immediately without waiting for a silence window", () => {
    const onDispatch = vi.fn();
    mk(onDispatch).dispatchNow("Tell me about distributed systems");

    // No timer advance: the assembler already waited out the silence.
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledWith("Tell me about distributed systems");
  });

  it("still drops a reaction or filler", () => {
    const onDispatch = vi.fn();
    const manager = mk(onDispatch);

    manager.dispatchNow("угу");
    manager.dispatchNow("мгм");
    manager.dispatchNow("ага");
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("still refuses while the AI is already answering", () => {
    const onDispatch = vi.fn();
    mk(onDispatch, "auto", true).dispatchNow("What is your experience with Kafka?");
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("still respects manual mode", () => {
    const onDispatch = vi.fn();
    mk(onDispatch, "manual").dispatchNow("What is your experience with Kafka?");
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("cancels a window already armed for the same utterance", () => {
    const onDispatch = vi.fn();
    const manager = mk(onDispatch);

    // A fragment armed the timer, then the assembler emitted the full question.
    manager.onFinalizedTranscript("Tell me about distributed");
    manager.dispatchNow("Tell me about distributed systems");

    expect(onDispatch).toHaveBeenCalledTimes(1);
    // The earlier window must not fire a second, duplicate dispatch.
    vi.advanceTimersByTime(5000);
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });
});
