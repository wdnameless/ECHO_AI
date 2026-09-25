import { describe, it, expect, vi, afterEach } from "vitest";
import { raceStall } from "../stall-guard";

/**
 * The stall guard must return control when a read never settles.
 *
 * This is the property `reader.cancel()` cannot provide over the Tauri HTTP
 * plugin: the body is a ReadableStream fed by an IPC channel, so cancelling the
 * reader leaves the pending `read()` unsettled — a guard built on cancel turns a
 * silent gateway into a permanent spinner, the exact failure it was meant to fix.
 */
describe("raceStall", () => {
  afterEach(() => vi.useRealTimers());

  it("rejects when the promise never settles within the budget", async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => {});
    const raced = raceStall(never, 1000);
    const assertion = expect(raced).rejects.toThrow("STALL");
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  it("passes the value through when the promise settles first", async () => {
    const raced = raceStall(Promise.resolve("chunk"), 1000);
    await expect(raced).resolves.toBe("chunk");
  });

  it("propagates a rejection from the promise itself", async () => {
    const raced = raceStall(Promise.reject(new Error("transport")), 1000);
    await expect(raced).rejects.toThrow("transport");
  });

  it("leaves no timer behind when the promise wins", async () => {
    vi.useFakeTimers();
    await raceStall(Promise.resolve(1), 5000);
    // A leaked timer would still be pending here and would reject an already
    // settled race on the next advance.
    expect(vi.getTimerCount()).toBe(0);
  });
});
