import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutoAskManager } from "../auto-ask";

/**
 * A question heard while the AI is answering must not be dropped.
 *
 * `shouldAutoAsk` rejects anything that arrives while `isAIProcessing` is true,
 * and `dispatchNow` returned outright — so every question the interviewer asked
 * during an answer was silently discarded: never asked, never surfaced. In a live
 * interview that is the most important question of the exchange, because the
 * interviewer asks it while reacting to the previous answer.
 */
describe("AutoAskManager held question", () => {
  const mk = (onDispatch: (t: string) => void, busy: () => boolean) =>
    new AutoAskManager({
      getConfig: () => ({ enabled: true, mode: "auto", silenceDurationMs: 1000 }),
      isAIProcessing: busy,
      onDispatch,
    });

  let busy: boolean;
  let onDispatch: ReturnType<typeof vi.fn<(t: string) => void>>;
  beforeEach(() => {
    busy = false;
    onDispatch = vi.fn<(t: string) => void>();
  });

  it("dispatches immediately when the AI is idle", () => {
    mk(onDispatch, () => busy).dispatchNow("Что такое Kafka?");
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledWith("Что такое Kafka?");
  });

  it("holds a question that arrives mid-answer instead of dropping it", () => {
    busy = true;
    const m = mk(onDispatch, () => busy);

    m.dispatchNow("А как вы решали конфликты?");
    // Nothing goes out while the answer is still streaming...
    expect(onDispatch).not.toHaveBeenCalled();
    expect(m.hasHeld()).toBe(true);
  });

  it("asks the held question as soon as the answer finishes", () => {
    busy = true;
    const m = mk(onDispatch, () => busy);
    m.dispatchNow("А как вы решали конфликты?");

    // The answer completes.
    busy = false;
    m.releaseHeld();

    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledWith("А как вы решали конфликты?");
    expect(m.hasHeld()).toBe(false);
  });

  it("keeps holding while another answer started", () => {
    busy = true;
    const m = mk(onDispatch, () => busy);
    m.dispatchNow("вопрос");

    // Still busy when the release is attempted: keep it.
    m.releaseHeld();
    expect(onDispatch).not.toHaveBeenCalled();
    expect(m.hasHeld()).toBe(true);

    busy = false;
    m.releaseHeld();
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });

  it("does not hold a filler that arrives mid-answer", () => {
    busy = true;
    const m = mk(onDispatch, () => busy);

    m.dispatchNow("угу");
    busy = false;
    m.releaseHeld();

    expect(onDispatch).not.toHaveBeenCalled();
    expect(m.hasHeld()).toBe(false);
  });

  it("keeps only the latest question when several arrive mid-answer", () => {
    busy = true;
    const m = mk(onDispatch, () => busy);

    m.dispatchNow("первый вопрос");
    m.dispatchNow("второй вопрос");
    busy = false;
    m.releaseHeld();

    // One answer can only serve one question; the newest is the live one.
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledWith("второй вопрос");
  });
});
