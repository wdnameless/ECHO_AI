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

/**
 * The report that started this: on a long interviewer turn the feed showed the
 * same Russian text twice. The VAD only closes an utterance on silence, so the
 * authoritative pass arrived more than eight seconds after the last live
 * partial — and that pass *contained* the text already on screen, which then
 * became a second row repeating it.
 */
describe("a late final does not repeat the previous line", () => {
  it("collapses a final that arrives after the window but contains the previous row", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useConversationStore());

      const tail =
        "Ах да, ты понимал. Этой причины недостаточно. Хочешь, чтобы тебя перевели тогда и убедительную причину.";
      // A finished row: `partial` is false, so only the time window and the
      // content can decide whether the next result belongs to it.
      act(() => result.current.appendLiveSegment("them", tail));
      // The monologue continues, and the next authoritative pass lands well past
      // the 8s window carrying everything already shown.
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      act(() =>
        result.current.appendLiveSegment(
          "them",
          `${tail} Да такую, с которой никак не поспоришь.`
        )
      );

      expect(result.current.liveSegments).toHaveLength(1);
      const text = result.current.liveSegments[0].text;
      // The repeated sentence must appear once.
      expect(text.toLowerCase().split("этой причины недостаточно").length - 1).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still starts a new line after the window when the content is different", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useConversationStore());

      act(() => result.current.appendLiveSegment("them", "Смотритель кошек."));
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      act(() => result.current.appendLiveSegment("them", "Отведи смертную душу в кольцо."));

      expect(result.current.liveSegments).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps two identical interjections apart after a long pause", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useConversationStore());

      // The same word twice is two events, not two readings of one utterance.
      act(() => result.current.appendLiveSegment("them", "Да."));
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      act(() => result.current.appendLiveSegment("them", "Да."));

      expect(result.current.liveSegments).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a re-worded result is not appended twice", () => {
  it("keeps one line when the recogniser re-phrases the same audio", () => {
    const { result } = renderHook(() => useConversationStore());

    // Two readings of the same speech, different wording, heavy overlap: the
    // earlier behaviour appended the second, so the line said the same thing
    // twice (the report from the running app).
    act(() =>
      result.current.appendLiveSegment(
        "them",
        "который оригинальной игре хотели здесь сделать"
      )
    );
    act(() =>
      result.current.appendLiveSegment(
        "them",
        "который в оригинальной игре хотели здесь сделать"
      )
    );

    expect(result.current.liveSegments).toHaveLength(1);
    const text = result.current.liveSegments[0].text;
    // The duplicated phrase must appear once, not twice.
    expect(text.toLowerCase().split("оригинальной").length - 1).toBe(1);
  });

  it("still appends a piece that is genuinely new", () => {
    const { result } = renderHook(() => useConversationStore());
    act(() => result.current.appendLiveSegment("them", "Смотритель кошек."));
    act(() =>
      result.current.appendLiveSegment("them", "Отведи смертную душу в кольцо.")
    );
    expect(result.current.liveSegments[0].text).toBe(
      "Смотритель кошек. Отведи смертную душу в кольцо."
    );
  });
});
