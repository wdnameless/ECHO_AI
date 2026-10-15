import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChatCompletion } from "../useChatCompletion";
import { useCompletion } from "../useCompletion";
import type { ChatConversation } from "@/types";
import type * as CompletionCommon from "../useCompletionCommon";

const boundaries = vi.hoisted(() => ({
  stream: vi.fn(), validate: vi.fn(), persist: vi.fn(), read: vi.fn(),
  shortcuts: { registerAudioCallback: vi.fn(), registerInputRef: vi.fn(), registerScreenshotCallback: vi.fn() },
  resizeWindow: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@/contexts", () => ({ useApp: () => ({
  selectedAIProvider: { provider: "mock", variables: {} }, allAiProviders: [{ id: "mock" }],
  systemPrompt: "", screenshotConfiguration: {}, setScreenshotConfiguration: vi.fn(),
  selectedSttProvider: { provider: "test" }, allSttProviders: [], selectedAudioDevices: {},
}) }));
vi.mock("@/hooks", () => ({ useGlobalShortcuts: () => boundaries.shortcuts }));
vi.mock("../useWindow", () => ({ useWindowResize: () => ({ resizeWindow: boundaries.resizeWindow }) }));
vi.mock("@/lib", () => {
  let id = 0;
  return {
    getConversationById: boundaries.read, generateRequestId: () => `request-${++id}`,
    generateMessageId: (role: string, ts: number) => `${role}-${ts}`,
    generateConversationId: () => `conversation-${++id}`, MESSAGE_ID_OFFSET: 1,
    getResponseSettings: () => ({ autoScroll: false }),
  };
});
vi.mock("../useCompletionCommon", async (importOriginal) => ({
  ...await importOriginal<typeof CompletionCommon>(),
  validateAIProvider: boundaries.validate, streamAIResponse: boundaries.stream,
  persistConversationTurn: boundaries.persist,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const chatA: ChatConversation = { id: "A", title: "Chat A", messages: [], createdAt: 1, updatedAt: 1 };
const chatB: ChatConversation = { id: "B", title: "Chat B", messages: [], createdAt: 2, updatedAt: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  boundaries.validate.mockReset().mockResolvedValue({ ok: true, provider: { id: "mock" } });
  boundaries.stream.mockReset();
  boundaries.persist.mockReset().mockResolvedValue(chatA);
  boundaries.read.mockReset().mockResolvedValue(chatA);
});

describe("completion ownership across conversation changes", () => {
  it("keeps the new chat visible when an old stream emits after a switch", async () => {
    const response = deferred<string | null>();
    boundaries.stream.mockReturnValue(response.promise);
    const setMessages = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ chat }) => useChatCompletion(chat.id, chat, setMessages), { initialProps: { chat: chatA } }
    );
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.submit("Question A"); });
    const options = boundaries.stream.mock.calls[0][0];
    rerender({ chat: chatB });
    setMessages.mockClear();
    act(() => { options.onChunk("late", "Answer A"); });
    expect(setMessages).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    await act(async () => { response.resolve(null); await pending; });
    unmount();
  });

  it("does not overwrite the new chat when an old completed turn finishes saving", async () => {
    const saved = deferred<ChatConversation>();
    boundaries.stream.mockResolvedValue("Answer A");
    boundaries.persist.mockReturnValue(saved.promise);
    const setMessages = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ chat }) => useChatCompletion(chat.id, chat, setMessages), { initialProps: { chat: chatA } }
    );
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.submit("Question A"); });
    rerender({ chat: chatB });
    setMessages.mockClear();
    await act(async () => { saved.resolve(chatA); await pending; });
    expect(setMessages).not.toHaveBeenCalled();
    unmount();
  });

  it("invalidates old output even when the user switches A to B and back to A", async () => {
    const response = deferred<string | null>();
    boundaries.stream.mockReturnValue(response.promise);
    const setMessages = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ chat }) => useChatCompletion(chat.id, chat, setMessages), { initialProps: { chat: chatA } }
    );
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.submit("Old question"); });
    const options = boundaries.stream.mock.calls[0][0];
    rerender({ chat: chatB }); rerender({ chat: chatA });
    setMessages.mockClear();
    act(() => { options.onChunk("late", "Old answer"); });
    expect(setMessages).not.toHaveBeenCalled();
    await act(async () => { response.resolve(null); await pending; });
    unmount();
  });

  it("does not insert the old question when validation finishes after a switch", async () => {
    const validation = deferred<{ ok: boolean }>();
    boundaries.validate.mockReturnValue(validation.promise);
    const setMessages = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ chat }) => useChatCompletion(chat.id, chat, setMessages), { initialProps: { chat: chatA } }
    );
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.submit("Old question"); });
    rerender({ chat: chatB });
    await act(async () => { validation.resolve({ ok: true }); await pending; });
    expect(setMessages).not.toHaveBeenCalled();
    unmount();
  });

  it("keeps a new overlay conversation empty when the previous stream emits", async () => {
    const response = deferred<string | null>();
    boundaries.stream.mockReturnValue(response.promise);
    const { result, unmount } = renderHook(() => useCompletion());
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.submit("Old question"); });
    const options = boundaries.stream.mock.calls[0][0];
    act(() => { result.current.startNewConversation(); options.onChunk("late", "Old answer"); });
    expect(result.current.response).toBe("");
    expect(result.current.currentConversationId).toBeNull();
    await act(async () => { response.resolve(null); await pending; });
    unmount();
  });

  it("retains a loaded overlay conversation when an old turn finishes saving", async () => {
    const saved = deferred<ChatConversation>();
    boundaries.stream.mockResolvedValue("Old answer");
    boundaries.persist.mockReturnValue(saved.promise);
    const { result, unmount } = renderHook(() => useCompletion());
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.submit("Old question"); });
    act(() => { result.current.loadConversation(chatB); });
    await act(async () => { saved.resolve(chatA); await pending; });
    expect(result.current.currentConversationId).toBe("B");
    expect(result.current.conversationHistory).toEqual(chatB.messages);
    unmount();
  });

  it("marks isLoading true until persistence settles and leaves recoverable input on error", async () => {
    const saved = deferred<ChatConversation>();
    boundaries.stream.mockResolvedValue("Old answer");
    boundaries.persist.mockReturnValue(saved.promise);
    const { result, unmount } = renderHook(() => useCompletion());
    act(() => { result.current.setInput("Unsaved question"); });
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.submit(); });
    expect(result.current.isLoading).toBe(true);
    await act(async () => { saved.reject(new Error("Disk error")); await pending; });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.input).toBe("Unsaved question");
    unmount();
  });

  it("preserves a single conversation identity during slow initial save", async () => {
    const saved1 = deferred<ChatConversation>();
    boundaries.stream.mockResolvedValue("Answer");
    boundaries.persist.mockReturnValue(saved1.promise);
    const { result, unmount } = renderHook(() => useCompletion());
    let p1!: Promise<void>;
    await act(async () => { p1 = result.current.submit("Question 1"); });
    expect(boundaries.persist).toHaveBeenCalledTimes(1);
    const initialId = boundaries.persist.mock.calls[0][0].conversationId;

    let p2!: Promise<void>;
    await act(async () => { p2 = result.current.submit("Question 2"); });
    await act(async () => {
      saved1.resolve({ ...chatA, id: initialId });
      await p1;
      await p2;
    });

    expect(boundaries.persist.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(boundaries.persist.mock.calls[1][0].conversationId).toBe(initialId);
    unmount();
  });

  it("does not let a previous save in the same conversation overwrite newer session state", async () => {
    const saved1 = deferred<ChatConversation>();
    boundaries.stream.mockResolvedValueOnce("Answer 1").mockResolvedValueOnce("Answer 2");
    boundaries.persist
      .mockReturnValueOnce(saved1.promise)
      .mockResolvedValueOnce({
        id: "conv-1",
        title: "Q2",
        messages: [{ id: "m2", role: "assistant", content: "Answer 2", timestamp: 200 }],
        createdAt: 100,
        updatedAt: 200,
      });
    const { result, unmount } = renderHook(() => useCompletion());
    let p1!: Promise<void>;
    await act(async () => { p1 = result.current.submit("Q1"); });
    let p2!: Promise<void>;
    await act(async () => { p2 = result.current.submit("Q2"); });

    await act(async () => {
      saved1.resolve({
        id: "conv-1",
        title: "Q1",
        messages: [{ id: "m1", role: "assistant", content: "Answer 1", timestamp: 100 }],
        createdAt: 100,
        updatedAt: 100,
      });
      await p1;
      await p2;
    });

    expect(result.current.conversationHistory).toEqual([
      { id: "m2", role: "assistant", content: "Answer 2", timestamp: 200 },
    ]);
    unmount();
  });

  it("recovers explicit state on persistence error in useChatCompletion without losing user input", async () => {
    const saved = deferred<ChatConversation>();
    boundaries.stream.mockResolvedValue("Answer A");
    boundaries.persist.mockReturnValue(saved.promise);
    const setMessages = vi.fn();
    const { result, unmount } = renderHook(
      ({ chat }) => useChatCompletion(chat.id, chat, setMessages),
      { initialProps: { chat: chatA } }
    );
    act(() => { result.current.setInput("Chat question"); });
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.submit(); });
    expect(result.current.isLoading).toBe(true);
    await act(async () => { saved.reject(new Error("Disk error")); await pending; });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.input).toBe("Chat question");
    unmount();
  });
});
