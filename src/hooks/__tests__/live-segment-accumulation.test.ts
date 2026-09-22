import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConversationStore } from "../useConversationStore";

vi.mock("@/lib/vocab", () => ({
  applyCorrections: (t: string) => t,
  loadCorrections: async () => {},
}));

/**
 * The feed used to show the same utterance twice: the recogniser streams a
 * growing partial and then reports the final, and every result became its own
 * row. One sentence arrived as a column of fragments.
 */
describe("live segment accumulation", () => {
  it("keeps one row while a partial grows into its final", () => {
    const { result } = renderHook(() => useConversationStore());

    act(() => result.current.appendLiveSegment("them", "И если конкретный лор", true));
    act(() =>
      result.current.appendLiveSegment("them", "И если конкретный лор или трек", true)
    );
    act(() =>
      result.current.appendLiveSegment(
        "them",
        "И если конкретный лор или трек, закройте контекст"
      )
    );

    expect(result.current.liveSegments).toHaveLength(1);
    expect(result.current.liveSegments[0].text).toBe(
      "И если конкретный лор или трек, закройте контекст"
    );
    expect(result.current.liveSegments[0].partial).toBe(false);
  });

  it("continues a line with a fragment that arrives after a pause", () => {
    const { result } = renderHook(() => useConversationStore());

    act(() => result.current.appendLiveSegment("them", "Не берет сило"));
    act(() => result.current.appendLiveSegment("them", "и вырваться из утроби"));

    expect(result.current.liveSegments).toHaveLength(1);
    expect(result.current.liveSegments[0].text).toBe("Не берет сило и вырваться из утроби");
  });

  it("ignores empty results", () => {
    const { result } = renderHook(() => useConversationStore());
    act(() => result.current.appendLiveSegment("them", "   "));
    expect(result.current.liveSegments).toHaveLength(0);
  });

  it("starts a new line once the continuation window has passed", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useConversationStore());

      act(() => result.current.appendLiveSegment("them", "Первое предложение"));
      // Past the window: a new sentence must not be glued to the previous one.
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      act(() => result.current.appendLiveSegment("them", "Совсем другая мысль"));

      expect(result.current.liveSegments).toHaveLength(2);
      expect(result.current.liveSegments[1].text).toBe("Совсем другая мысль");
    } finally {
      vi.useRealTimers();
    }
  });
});
