import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConversationStore } from "../useConversationStore";
import { setCachedCorrections, AsrCorrection } from "@/lib/vocab";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/storage", () => ({
  saveConversation: vi.fn().mockResolvedValue(undefined),
  generateConversationTitle: vi.fn((text: string) => `Title: ${text.slice(0, 10)}`),
}));

describe("useConversationStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setCachedCorrections([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("appends final live segments and maintains stable order", () => {
    const { result } = renderHook(() => useConversationStore());

    act(() => {
      result.current.appendLiveSegment("them", "Segment 1", false);
    });

    expect(result.current.liveSegments).toHaveLength(1);
    expect(result.current.liveSegments[0].text).toBe("Segment 1");
    expect(result.current.liveSegments[0].source).toBe("them");
    expect(result.current.liveSegments[0].partial).toBe(false);

    act(() => {
      result.current.appendLiveSegment("me", "Segment 2", false);
    });

    expect(result.current.liveSegments).toHaveLength(2);
    expect(result.current.liveSegments[1].text).toBe("Segment 2");
    expect(result.current.liveSegments[1].source).toBe("me");
  });

  it("updates existing segment on partial speech updates of same speaker", () => {
    const { result } = renderHook(() => useConversationStore());

    act(() => {
      result.current.appendLiveSegment("them", "Первое слово", true);
    });

    expect(result.current.liveSegments).toHaveLength(1);
    expect(result.current.liveSegments[0].text).toBe("Первое слово");
    expect(result.current.liveSegments[0].partial).toBe(true);

    // Partial update for same speaker should update existing segment in place
    act(() => {
      result.current.appendLiveSegment("them", "Первое слово и второе", true);
    });

    expect(result.current.liveSegments).toHaveLength(1);
    expect(result.current.liveSegments[0].text).toBe("Первое слово и второе");
    expect(result.current.liveSegments[0].partial).toBe(true);
  });

  it("applies vocabulary corrections when appending live segments", () => {
    const corrections: AsrCorrection[] = [
      { wrong: "плюли", right: "Pluely" },
    ];
    setCachedCorrections(corrections);

    const { result } = renderHook(() => useConversationStore());

    act(() => {
      result.current.appendLiveSegment("them", "Это проект плюли для тестов", false);
    });

    expect(result.current.liveSegments[0].text).toBe("Это проект Pluely для тестов");
  });

  it("adds interaction pairs and generates history for AI context", () => {
    const { result } = renderHook(() => useConversationStore());

    act(() => {
      result.current.addInteraction(
        "Расскажи о себе",
        "Я AI ассистент",
        "them"
      );
    });

    expect(result.current.conversation.messages).toHaveLength(2);
    expect(result.current.conversation.messages[0].content).toBe("Расскажи о себе");
    expect(result.current.conversation.messages[0].role).toBe("user");
    expect(result.current.conversation.messages[1].content).toBe("Я AI ассистент");
    expect(result.current.conversation.messages[1].role).toBe("assistant");

    // Check history prefix formatting for candidate turn
    act(() => {
      result.current.addInteraction(
        "Мой опыт в React 5 лет",
        "Понятно",
        "me"
      );
    });

    const history = result.current.buildHistory(result.current.conversation.messages);
    const candidateTurn = history.find((h) =>
      typeof h.content === "string" && h.content.includes("CANDIDATE ANSWER")
    );
    expect(candidateTurn).toBeDefined();
    expect(typeof candidateTurn?.content === "string" ? candidateTurn.content : "").toContain("Мой опыт в React 5 лет");
  });

  it("clears conversation and live segments on resetConversation", () => {
    const { result } = renderHook(() => useConversationStore());

    act(() => {
      result.current.appendLiveSegment("them", "Text", false);
      result.current.addInteraction("Q", "A", "them");
      result.current.setMyLastTranscription("My text");
      result.current.setTheirLastTranscription("Their text");
    });

    expect(result.current.liveSegments.length).toBeGreaterThan(0);
    expect(result.current.conversation.messages.length).toBeGreaterThan(0);
    expect(result.current.myLastTranscription).toBe("My text");

    act(() => {
      result.current.resetConversation();
    });

    expect(result.current.liveSegments).toEqual([]);
    expect(result.current.conversation.messages).toEqual([]);
    expect(result.current.myLastTranscription).toBe("");
    expect(result.current.theirLastTranscription).toBe("");
  });
});
