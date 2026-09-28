import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  useTranslationQueue,
  TRANSLATE_RETRY_BACKOFF_MS,
  type TranslationEntry,
} from "../useTranslationQueue";

/**
 * The queue used to live inside `SubtitleFeed` as a ref plus a state tick whose
 * relationship was expressed nowhere, and both defects that reached users came
 * from that coupling:
 *
 * - a failure bumped a state that was also a dependency of the queue effect, so
 *   React tore the effect down and the in-flight workers were cancelled;
 * - a result arriving during teardown was discarded without recording a result
 *   OR a failure, so the row kept its spinner until the next utterance.
 *
 * Extracting it makes those two behaviours testable, which they were not inside a
 * 1000-line component.
 */
const fastTranslate = vi.fn();
vi.mock("@/lib/fast-translator", () => ({
  fastTranslate: (...args: unknown[]) => fastTranslate(...args),
}));

const entry = (text: string, ts = 1): TranslationEntry => ({ text, ts });

beforeEach(() => {
  fastTranslate.mockReset();
});

describe("useTranslationQueue", () => {
  it("translates a finished row", async () => {
    fastTranslate.mockResolvedValue("Hello");
    const { result } = renderHook(() =>
      useTranslationQueue([entry("Привет")], true)
    );

    await waitFor(() => expect(result.current.translations["Привет"]).toBe("Hello"));
  });

  it("skips a streaming row entirely", async () => {
    fastTranslate.mockResolvedValue("should not be called");
    renderHook(() =>
      useTranslationQueue([{ text: "живая", ts: 1, streaming: true }], true)
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(fastTranslate).not.toHaveBeenCalled();
  });

  it("records a failure instead of storing the source as its translation", async () => {
    // A provider failure returns the input unchanged; storing that made the row
    // read «русский переводит русский».
    fastTranslate.mockResolvedValue("Привет");
    const { result } = renderHook(() =>
      useTranslationQueue([entry("Привет")], true)
    );

    await waitFor(() => expect(result.current.hasFailed("Привет")).toBe(true));
    expect(result.current.translations["Привет"]).toBeUndefined();
  });

  it("does not retry a failed row while its backoff holds", async () => {
    fastTranslate.mockResolvedValue("");
    // ONE hook instance for the whole case: a second `renderHook` would run its
    // own queue against the same module mock and the call count would describe
    // both, which is what made an earlier version of this test lie.
    const { result, rerender } = renderHook(
      ({ entries }: { entries: TranslationEntry[] }) =>
        useTranslationQueue(entries, true),
      { initialProps: { entries: [entry("Привет")] } }
    );

    await waitFor(() => expect(result.current.hasFailed("Привет")).toBe(true));
    const callsAfterFailure = fastTranslate.mock.calls.length;
    expect(callsAfterFailure).toBeGreaterThan(0);

    // New speech arrives, which re-runs the effect.
    rerender({ entries: [entry("Привет"), entry("Ещё", 2)] });
    await new Promise((r) => setTimeout(r, 60));

    // The failed row is not hit again while its backoff holds.
    const hitsOnFailedRow = fastTranslate.mock.calls
      .map((c) => c[0])
      .filter((k) => k === "Привет").length;
    expect(hitsOnFailedRow).toBe(1);
  });

  it("keeps a result that lands during teardown", async () => {
    // The row must not be left with neither a result nor a failure mark: that
    // stall was the reported "spinner forever".
    //
    // Resolvers are keyed BY TEXT. A single `release` variable captures the LAST
    // call made, so an earlier version of this test resolved the wrong request
    // and asserted against the wrong row.
    const resolvers = new Map<string, (v: string) => void>();
    fastTranslate.mockImplementation(
      (key: string) =>
        new Promise<string>((r) => {
          resolvers.set(key, r);
        })
    );

    const { result, rerender } = renderHook(
      ({ entries }: { entries: TranslationEntry[] }) =>
        useTranslationQueue(entries, true),
      { initialProps: { entries: [entry("Первая")] } }
    );
    await waitFor(() => expect(resolvers.has("Первая")).toBe(true));

    // A new entry tears the effect down while the first call is in flight, and
    // then that first answer arrives.
    rerender({ entries: [entry("Первая"), entry("Вторая", 2)] });
    await act(async () => {
      resolvers.get("Первая")?.("First!");
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(result.current.translations["Первая"]).toBe("First!")
    );
  });

  it("stops working when disabled", async () => {
    fastTranslate.mockResolvedValue("x");
    renderHook(() => useTranslationQueue([entry("Привет")], false));

    await new Promise((r) => setTimeout(r, 30));
    expect(fastTranslate).not.toHaveBeenCalled();
  });

  it("exports the backoff it honours", () => {
    expect(TRANSLATE_RETRY_BACKOFF_MS).toBeGreaterThan(0);
  });
});
