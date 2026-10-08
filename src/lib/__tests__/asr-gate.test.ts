import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  releaseStream,
  resetAsrGateForTests,
  tryAcquireStream,
  withNoStream,
  enqueueStreamSlot,
  waitForStreamSlot,
  getSlotQueueLength,
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

  describe("explicit slot queue", () => {
    it("calls callback immediately when model is free", () => {
      const callback = vi.fn();
      enqueueStreamSlot("me", callback);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(tryAcquireStream("them")).toBe(false);
    });

    it("queues waiter when busy and grants slot immediately on releaseStream without backoff", () => {
      expect(tryAcquireStream("them")).toBe(true);
      const meCallback = vi.fn();

      const cancel = enqueueStreamSlot("me", meCallback);
      expect(meCallback).not.toHaveBeenCalled();
      expect(getSlotQueueLength()).toBe(1);

      // Them releases the stream: Me gets notified immediately
      releaseStream("them");
      expect(meCallback).toHaveBeenCalledTimes(1);
      expect(getSlotQueueLength()).toBe(0);
      // Now "me" owns the model
      expect(tryAcquireStream("them")).toBe(false);
      cancel();
    });

    it("grants slot in FIFO order to multiple queued requests", () => {
      expect(tryAcquireStream("them")).toBe(true);
      const calls: string[] = [];
      enqueueStreamSlot("me", () => calls.push("me-1"));
      enqueueStreamSlot("me", () => calls.push("me-2"));
      expect(getSlotQueueLength()).toBe(2);

      releaseStream("them");
      expect(calls).toEqual(["me-1"]);
      expect(getSlotQueueLength()).toBe(1);

      releaseStream("me");
      expect(calls).toEqual(["me-1", "me-2"]);
      expect(getSlotQueueLength()).toBe(0);
    });

    it("cancels slot queue entry when cancelled", () => {
      expect(tryAcquireStream("them")).toBe(true);
      const callback = vi.fn();
      const cancel = enqueueStreamSlot("me", callback);
      expect(getSlotQueueLength()).toBe(1);

      cancel();
      expect(getSlotQueueLength()).toBe(0);
      releaseStream("them");
      expect(callback).not.toHaveBeenCalled();
    });

    it("waitForStreamSlot resolves when stream becomes available", async () => {
      expect(tryAcquireStream("them")).toBe(true);
      const waitPromise = waitForStreamSlot("me", 1000);

      releaseStream("them");
      await expect(waitPromise).resolves.toBe(true);
    });
  });
});
