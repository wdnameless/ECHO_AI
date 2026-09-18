import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  setUnthrottledTimeout,
  resetTimerWorkerForTests,
} from "../timer-worker";

/**
 * The gap timer that emits interview questions must not be throttled when the
 * window is hidden. Chromium clamps main-thread `setTimeout` in hidden windows
 * (typically to 1s granularity), which would delay every question emission in
 * meeting mode — the normal state for an overlay during a call.
 *
 * These tests drive the worker directly, so they prove the scheduling path
 * rather than the browser's throttling policy.
 */
describe("setUnthrottledTimeout", () => {
  let posted: Array<{ id: number; delay: number }> = [];
  let lastWorker: FakeWorker | null = null;

  /**
   * Stands in for a real Worker.
   *
   * `onmessage` is a plain own property here — the module assigns it, and the
   * test reads it back from the same instance. A prototype accessor would not
   * work: class fields are installed per instance and would shadow it.
   */
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    postMessage(message: { id: number; delay: number }) {
      posted.push(message);
    }
    terminate(): void {}
  }

  /** Delivers a deadline notification the way the real worker would. */
  const fire = (index: number) => {
    const message = posted[index];
    lastWorker?.onmessage?.({ data: { id: message.id } });
  };

  beforeEach(() => {
    posted = [];
    lastWorker = null;
    // The module caches one worker for the process; without this each test
    // would talk to the previous test's instance.
    resetTimerWorkerForTests();
    vi.stubGlobal(
      "Worker",
      class extends FakeWorker {
        constructor() {
          super();
          lastWorker = this;
        }
      } as unknown as typeof Worker
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fake"),
    });
  });

  afterEach(() => {
    resetTimerWorkerForTests();
    vi.unstubAllGlobals();
  });

  it("schedules through the worker rather than the main thread", () => {
    const fn = vi.fn();
    setUnthrottledTimeout(fn, 250);

    // The delay reaches the worker unchanged: a clamped 250ms would surface
    // here as 1000ms and the test would catch it.
    expect(posted).toHaveLength(1);
    expect(posted[0].delay).toBe(250);
    expect(fn).not.toHaveBeenCalled();
  });

  it("runs the callback when the worker reports the deadline", () => {
    const fn = vi.fn();
    setUnthrottledTimeout(fn, 250);

    fire(0);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancelling prevents the callback from running", () => {
    const fn = vi.fn();
    const cancel = setUnthrottledTimeout(fn, 250);
    cancel();

    fire(0);

    expect(fn).not.toHaveBeenCalled();
  });

  it("keeps distinct timers independent", () => {
    const first = vi.fn();
    const second = vi.fn();
    setUnthrottledTimeout(first, 100);
    setUnthrottledTimeout(second, 200);

    // Fire only the second timer's deadline.
    fire(1);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("never passes a negative delay to the worker", () => {
    setUnthrottledTimeout(vi.fn(), -50);
    expect(posted[0].delay).toBe(0);
  });
});

describe("setUnthrottledTimeout without a Worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetTimerWorkerForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("falls back to a main-thread timer instead of throwing", () => {
    // Environments without Worker support (hardened WebViews, jsdom) must still
    // get a working timer; losing the throttling exemption is acceptable,
    // failing to schedule at all is not.
    vi.stubGlobal("Worker", undefined);

    const fn = vi.fn();
    setUnthrottledTimeout(fn, 10);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("the fallback timer can still be cancelled", () => {
    vi.stubGlobal("Worker", undefined);

    const fn = vi.fn();
    const cancel = setUnthrottledTimeout(fn, 10);
    cancel();

    vi.advanceTimersByTime(50);

    expect(fn).not.toHaveBeenCalled();
  });
});
