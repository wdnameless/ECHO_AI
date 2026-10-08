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

    it("does not starve withNoStream when channels alternate rapidly in slot queue (R05)", async () => {
      expect(tryAcquireStream("them")).toBe(true);

      const meCallback = vi.fn();
      enqueueStreamSlot("me", meCallback);

      const httpWork = vi.fn().mockResolvedValue("transcribed-them-final");
      const httpPending = withNoStream(httpWork);

      // "them" finishes streaming and releases.
      // "me" was already in slot queue, but HTTP work should not starve.
      releaseStream("them");

      // HTTP work resolves without false "model busy" error
      await expect(httpPending).resolves.toBe("transcribed-them-final");
      expect(httpWork).toHaveBeenCalledTimes(1);

      // And after HTTP finishes, "me" gets the slot
      expect(meCallback).toHaveBeenCalledTimes(1);
      expect(tryAcquireStream("them")).toBe(false);
    });

    it("handles repeated channel alternation with interleaved HTTP transcriptions without false model busy (R05)", async () => {
      expect(tryAcquireStream("them")).toBe(true);

      // Channel 1 -> HTTP 1 while Channel 2 is queued
      const meCalls: number[] = [];
      enqueueStreamSlot("me", () => {
        meCalls.push(1);
      });

      const http1 = vi.fn().mockResolvedValue("final-1");
      const pending1 = withNoStream(http1);

      releaseStream("them");
      await expect(pending1).resolves.toBe("final-1");
      expect(meCalls).toEqual([1]);

      // Now "me" holds the stream. Queue "them" and HTTP 2
      const themCalls: number[] = [];
      enqueueStreamSlot("them", () => {
        themCalls.push(2);
      });

      const http2 = vi.fn().mockResolvedValue("final-2");
      const pending2 = withNoStream(http2);

      releaseStream("me");
      await expect(pending2).resolves.toBe("final-2");
      expect(themCalls).toEqual([2]);
    });

    it("blocks tryAcquireStream while HTTP work is actively executing to prevent collision (R05)", async () => {
      let resolveHttp: (val: string) => void;
      const httpWork = () =>
        new Promise<string>((resolve) => {
          resolveHttp = resolve;
        });

      const pending = withNoStream(httpWork);
      // While HTTP work is in-flight, stream cannot acquire
      expect(tryAcquireStream("them")).toBe(false);
      expect(tryAcquireStream("me")).toBe(false);

      resolveHttp!("done");
      await expect(pending).resolves.toBe("done");

      // Free once HTTP finishes
      expect(tryAcquireStream("them")).toBe(true);
    });
  });
});
