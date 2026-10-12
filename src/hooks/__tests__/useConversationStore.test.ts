import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useConversationStore,
  ChatConversation,
  toChronologicalMessages,
} from "../useConversationStore";
import { setCachedCorrections, AsrCorrection } from "@/lib/vocab";
import {
  saveFillerFilterConfig,
  FILLER_FILTER_STORAGE_KEYS,
} from "@/lib/filler-filter";
import { safeLocalStorage } from "@/lib/storage/helper";
import { saveConversation } from "@/lib/database";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/database", () => ({
  saveConversation: vi.fn().mockResolvedValue(undefined),
  generateConversationTitle: vi.fn((text: string) => `Title: ${text.slice(0, 10)}`),
}));

describe("useConversationStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setCachedCorrections([]);
    safeLocalStorage.removeItem(FILLER_FILTER_STORAGE_KEYS.FILTER_AI_ENABLED);
    safeLocalStorage.removeItem(FILLER_FILTER_STORAGE_KEYS.FILTER_FEED_ENABLED);
    safeLocalStorage.removeItem(FILLER_FILTER_STORAGE_KEYS.CUSTOM_FILLERS);
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

  it("filters fillers in live segments only when filterFeedEnabled is true", () => {
    const { result } = renderHook(() => useConversationStore());

    // Default: feed filtering is disabled
    act(() => {
      result.current.appendLiveSegment("them", "Ну типа привет как бы мир", false);
    });
    expect(result.current.liveSegments[0].text).toBe("Ну типа привет как бы мир");

    // Enable feed filtering
    saveFillerFilterConfig({
      filterAiEnabled: true,
      filterFeedEnabled: true,
      customFillers: "",
    });

    act(() => {
      result.current.appendLiveSegment("me", "Ээ короче я готов", false);
    });
    expect(result.current.liveSegments[1].text).toBe("я готов");
  });

  it("keeps user speech intact by default, filters only when opted in", () => {
    const { result } = renderHook(() => useConversationStore());

    act(() => {
      result.current.addInteraction("Эм ну расскажи про Redux", "Redux это библиотека", "them");
    });

    // Default: no filtering — the model sees how the user actually talks.
    expect(result.current.conversation.messages[0].content).toBe("Эм ну расскажи про Redux");

    saveFillerFilterConfig({ filterAiEnabled: true });
    act(() => {
      result.current.addInteraction("Эм ну расскажи про Vue", "Vue это фреймворк", "them");
    });
    expect(result.current.conversation.messages[0].content).toBe("расскажи про Vue");
    // The first pair kept its fillers at save time (default was off then).
    expect(result.current.conversation.messages[2].content).toBe("Эм ну расскажи про Redux");
  });

  it("builds history in chronological order (oldest -> newest) from multiple interactions", () => {
    const { result } = renderHook(() => useConversationStore());

    act(() => {
      vi.setSystemTime(1000);
      result.current.addInteraction("Question 1", "Answer 1", "them");
    });
    act(() => {
      vi.setSystemTime(2000);
      result.current.addInteraction("Question 2", "Answer 2", "them");
    });
    act(() => {
      vi.setSystemTime(3000);
      result.current.addInteraction("Question 3", "Answer 3", "them");
    });

    // Storage order in conversation.messages remains newest-first
    expect(result.current.conversation.messages[0].content).toBe("Question 3");

    // History handed to LLM is chronological (oldest -> newest)
    const history = result.current.buildHistory(result.current.conversation.messages);
    expect(history).toHaveLength(6);
    expect(history[0].content).toBe("[Interviewer (question)] Question 1");
    expect(history[1].content).toBe("Answer 1");
    expect(history[2].content).toBe("[Interviewer (question)] Question 2");
    expect(history[3].content).toBe("Answer 2");
    expect(history[4].content).toBe("[Interviewer (question)] Question 3");
    expect(history[5].content).toBe("Answer 3");
  });

  it("performs trailing save without dropping updates when save is in flight", async () => {
    const saveMock = vi.mocked(saveConversation);
    saveMock.mockClear();
    let resolveFirstSave: (val: ChatConversation) => void = () => {};
    saveMock.mockImplementationOnce(
      () =>
        new Promise<ChatConversation>((resolve) => {
          resolveFirstSave = resolve;
        })
    );

    const { result } = renderHook(() => useConversationStore());
    act(() => {
      result.current.resetConversation();
      result.current.addInteraction("Q1", "A1", "them");
    });

    // Advance 500ms to trigger the first save
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(saveMock).toHaveBeenCalledTimes(1);

    // Add second interaction while first save is still in flight
    act(() => {
      result.current.addInteraction("Q2", "A2", "them");
    });

    // Advance 500ms for debounce timer to fire while first save is still in flight
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Concurrency is prevented: still 1 call
    expect(saveMock).toHaveBeenCalledTimes(1);

    // First save finishes
    await act(async () => {
      resolveFirstSave(result.current.conversation);
    });

    // Trailing save executed with newest state containing both Q1 and Q2
    expect(saveMock).toHaveBeenCalledTimes(2);
    const lastSaved = saveMock.mock.calls[1][0] as { messages: Array<{ content: string }> };
    expect(lastSaved.messages.some((m) => m.content === "Q1")).toBe(true);
    expect(lastSaved.messages.some((m) => m.content === "Q2")).toBe(true);
  });

  it("toChronologicalMessages normalizes newest-first arrays to oldest-first", () => {
    const messages = [
      { id: "3", timestamp: 3000, content: "three" },
      { id: "2", timestamp: 2000, content: "two" },
      { id: "1", timestamp: 1000, content: "one" },
    ];
    const result = toChronologicalMessages(messages);
    expect(result.map((m) => m.content)).toEqual(["one", "two", "three"]);
  });

  it("toChronologicalMessages selects newest-N window before sorting", () => {
    const newestFirst = [
      { id: "4", timestamp: 4000, content: "four" },
      { id: "3", timestamp: 3000, content: "three" },
      { id: "2", timestamp: 2000, content: "two" },
      { id: "1", timestamp: 1000, content: "one" },
    ];
    const fromNewest = toChronologicalMessages(newestFirst, 2);
    expect(fromNewest.map((m) => m.content)).toEqual(["three", "four"]);

    const oldestFirst = [
      { id: "1", timestamp: 1000, content: "one" },
      { id: "2", timestamp: 2000, content: "two" },
      { id: "3", timestamp: 3000, content: "three" },
      { id: "4", timestamp: 4000, content: "four" },
    ];
    const fromOldest = toChronologicalMessages(oldestFirst, 2);
    expect(fromOldest.map((m) => m.content)).toEqual(["three", "four"]);
  });

  it("authoritatively replaces current draft when final is shorter or reworded (R05)", () => {
    const { result } = renderHook(() => useConversationStore());
    act(() => {
      result.current.appendLiveSegment(
        "them",
        "Я никогда не работал с Docker в production.",
        true
      );
    });
    const initialId = result.current.liveSegments[0].id;

    act(() => {
      result.current.appendLiveSegment(
        "them",
        "Я работал с Docker в production.",
        false
      );
    });

    expect(result.current.liveSegments).toHaveLength(1);
    expect(result.current.liveSegments[0].text).toBe(
      "Я работал с Docker в production."
    );
    expect(result.current.liveSegments[0].partial).toBe(false);
    expect(result.current.liveSegments[0].id).toBe(initialId);
  });

  it("flushes pending conversation save on resetConversation before debounce expires (R06)", async () => {
    const saveMock = vi.mocked(saveConversation);
    saveMock.mockClear();

    const { result, unmount } = renderHook(() => useConversationStore());
    act(() => {
      result.current.setConversation({
        id: "conv-before-reset",
        title: "test title",
        createdAt: 1000,
        updatedAt: 2000,
        messages: [
          { id: "m1", role: "user", content: "hello before reset", timestamp: 1500 },
        ],
      });
    });

    // Before 500ms debounce expires, call resetConversation
    act(() => {
      result.current.resetConversation();
    });

    // Unmount later
    unmount();

    // The old conversation snapshot must have been flushed and saved
    expect(saveMock).toHaveBeenCalled();
    const savedConv = saveMock.mock.calls[0][0] as ChatConversation;
    expect(savedConv.id).toBe("conv-before-reset");
    expect(savedConv.messages).toHaveLength(1);
    expect(savedConv.messages[0].content).toBe("hello before reset");
  });

  it("flushes previous conversation on direct setConversation ID switch without dropping it (R06)", async () => {
    const saveMock = vi.mocked(saveConversation);
    saveMock.mockClear();

    const { result, unmount } = renderHook(() => useConversationStore());
    act(() => {
      result.current.setConversation({
        id: "conv-direct-switch-1",
        title: "title 1",
        createdAt: 1000,
        updatedAt: 2000,
        messages: [
          { id: "m1", role: "user", content: "direct switch msg", timestamp: 1500 },
        ],
      });
    });

    // Switch ID directly as done in useSystemAudio:660
    act(() => {
      result.current.setConversation({
        id: "conv-direct-switch-2",
        title: "",
        createdAt: 0,
        updatedAt: 0,
        messages: [],
      });
    });

    unmount();

    expect(saveMock).toHaveBeenCalled();
    const savedConv = saveMock.mock.calls[0][0] as ChatConversation;
    expect(savedConv.id).toBe("conv-direct-switch-1");
  });

  it("retains queued snapshots from prior IDs when switching while save is in flight (R06)", async () => {
    const saveMock = vi.mocked(saveConversation);
    saveMock.mockClear();

    let resolveFirstSave: () => void = () => {};
    saveMock.mockImplementationOnce(
      (conversation) =>
        new Promise<ChatConversation>((resolve) => {
          resolveFirstSave = () => resolve(conversation);
        })
    );

    const { result } = renderHook(() => useConversationStore());
    act(() => {
      result.current.setConversation({
        id: "conv-flight-1",
        title: "title 1",
        createdAt: 1000,
        updatedAt: 2000,
        messages: [
          { id: "m1", role: "user", content: "m1", timestamp: 1500 },
        ],
      });
    });

    // Trigger save for conv-flight-1
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(saveMock).toHaveBeenCalledTimes(1);

    // Update conv-flight-1 with another message while save is in flight
    act(() => {
      result.current.setConversation({
        id: "conv-flight-1",
        title: "title 1",
        createdAt: 1000,
        updatedAt: 2500,
        messages: [
          { id: "m1", role: "user", content: "m1", timestamp: 1500 },
          { id: "m2", role: "user", content: "m2", timestamp: 2500 },
        ],
      });
    });

    // Switch to conv-flight-2 while first save is still in flight
    act(() => {
      result.current.setConversation({
        id: "conv-flight-2",
        title: "title 2",
        createdAt: 2000,
        updatedAt: 3000,
        messages: [
          { id: "m3", role: "user", content: "m3", timestamp: 2800 },
        ],
      });
    });

    // Trigger debounce for conv-flight-2
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Still only first call in flight
    expect(saveMock).toHaveBeenCalledTimes(1);

    // First save finishes
    await act(async () => {
      resolveFirstSave();
    });

    // Both trailing conv-flight-1 (with m1 and m2) and conv-flight-2 are saved
    expect(saveMock).toHaveBeenCalledTimes(3);
    const secondCall = saveMock.mock.calls[1][0] as ChatConversation;
    expect(secondCall.id).toBe("conv-flight-1");
    expect(secondCall.messages).toHaveLength(2);

    const thirdCall = saveMock.mock.calls[2][0] as ChatConversation;
    expect(thirdCall.id).toBe("conv-flight-2");
    expect(thirdCall.messages).toHaveLength(1);
  });
});
