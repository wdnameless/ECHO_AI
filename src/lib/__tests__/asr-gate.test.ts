import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  releaseStream,
  resetAsrGateForTests,
  tryAcquireStream,
  withNoStream,
} from "../asr-gate";

/**
 * The sidecar serves one stream per model: a second stream is refused with
 * "model busy", and while a stream is open even plain HTTP transcription fails
 * with `500 model busy: a stream is active on this model`. These pin the rule
 * the app now follows instead of walking into those refusals.
 */
describe("ASR stream gate", () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetAsrGateForTests();
  });

  it("lets only one channel hold the model", () => {
    expect(tryAcquireStream("them")).toBe(true);
    expect(tryAcquireStream("me")).toBe(false);
    // The owner may re-enter (reconnects, repeated starts).
    expect(tryAcquireStream("them")).toBe(true);
    releaseStream("them");
    expect(tryAcquireStream("me")).toBe(true);
  });

  it("ignores a release from a channel that does not own it", () => {
    expect(tryAcquireStream("them")).toBe(true);
    releaseStream("me"); // not the owner
    expect(tryAcquireStream("me")).toBe(false);
  });

  it("runs immediately when nothing is streaming", async () => {
    const work = vi.fn().mockResolvedValue("done");
    await expect(withNoStream(work)).resolves.toBe("done");
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("queues HTTP work until the stream ends", async () => {
    expect(tryAcquireStream("them")).toBe(true);
    const work = vi.fn().mockResolvedValue("transcribed");

    let settled = false;
    const pending = withNoStream(work).then((value) => {
      settled = true;
      return value;
    });

    // Still blocked while the stream is up.
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(work).not.toHaveBeenCalled();

    releaseStream("them");
    await expect(pending).resolves.toBe("transcribed");
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("fails fast with an error after the timeout if the stream is still active", async () => {
    vi.useFakeTimers();
    expect(tryAcquireStream("them")).toBe(true);
    const work = vi.fn().mockResolvedValue("late");

    const pending = withNoStream(work, 1000);
    const assertion = expect(pending).rejects.toThrow(/busy|stream active/i);
    await vi.advanceTimersByTimeAsync(1000);

    await assertion;
    expect(work).not.toHaveBeenCalled();
  });
});
