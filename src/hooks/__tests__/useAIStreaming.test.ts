import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAIStreaming, SelectedAIProviderConfig } from "../useAIStreaming";
import type { ChatConversation } from "../useConversationStore";
import { fetchAIResponse } from "@/lib/functions";
import { shouldUsePluelyAPI } from "@/lib";
import type { TYPE_PROVIDER } from "@/types";

vi.mock("@/lib/functions", () => ({
  fetchAIResponse: vi.fn(),
}));

vi.mock("@/lib", () => ({
  shouldUsePluelyAPI: vi.fn(),
}));

describe("useAIStreaming", () => {
  const defaultSelectedProvider: SelectedAIProviderConfig = {
    provider: "openai",
    variables: { model: "gpt-4o" },
  };

  const defaultAllProviders: TYPE_PROVIDER[] = [
    {
      id: "openai",
      curl: "curl -X POST https://api.openai.com/v1/chat/completions",
      streaming: true,
    },
  ];

  const defaultConversation: ChatConversation = {
    id: "conv-1",
    title: "Test Conversation",
    messages: [],
    createdAt: 1000,
    updatedAt: 1000,
  };

  const buildHistory = vi.fn(() => []);
  const addInteraction = vi.fn();
  const setFillerForInterviewer = vi.fn();
  const clearFiller = vi.fn();
  const onError = vi.fn();
  const setPendingScreenshot = vi.fn();

  beforeEach(() => {
    vi.mocked(shouldUsePluelyAPI).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createHookProps() {
    const pendingScreenshotRef = { current: null as string | null };
    return {
      selectedAIProvider: defaultSelectedProvider,
      allAiProviders: defaultAllProviders,
      systemPrompt: "You are a helpful assistant",
      contextContent: "",
      useSystemPrompt: true,
      conversation: defaultConversation,
      buildHistory,
      addInteraction,
      setFillerForInterviewer,
      clearFiller,
      onError,
      pendingScreenshotRef,
      setPendingScreenshot,
    };
  }

  it("skips conversational fillers and backchannels via triggerAIForQuestion", async () => {
    const props = createHookProps();
    const { result } = renderHook(() => useAIStreaming(props));

    await act(async () => {
      await result.current.triggerAIForQuestion("да", "them");
    });

    expect(props.setFillerForInterviewer).not.toHaveBeenCalled();
    expect(fetchAIResponse).not.toHaveBeenCalled();
  });

  it("enforces post-answer cooldown for short non-question reactions", async () => {
    async function* makeChunkGenerator() {
      yield "Ответ на вопрос.";
    }
    vi.mocked(fetchAIResponse).mockReturnValue(makeChunkGenerator());

    const props = createHookProps();
    const { result } = renderHook(() => useAIStreaming(props));

    // Simulate that an AI response was completed 500ms ago (cooldown is 2000ms)
    result.current.lastAIResponseAtRef.current = Date.now() - 500;

    await act(async () => {
      // 4 words (> 2 words so passes speech-filter) but length < 60 and doesn't start with question word
      await result.current.triggerAIForQuestion("мы теперь идем дальше", "them");
    });

    expect(fetchAIResponse).not.toHaveBeenCalled();

    // Explicit question start bypasses cooldown (starts with 'what')
    await act(async () => {
      await result.current.triggerAIForQuestion("what is the architectural difference here?", "them");
    });

    expect(fetchAIResponse).toHaveBeenCalled();
  });

  it("aborts active streaming request when abortAI is called", async () => {
    const props = createHookProps();
    const { result } = renderHook(() => useAIStreaming(props));

    let receivedSignal: AbortSignal | null = null;

    async function* infiniteStream() {
      yield "Chunk 1";
      // Wait until aborted
      await new Promise<void>((resolve) => {
        const sig = receivedSignal;
        if (sig && sig.aborted) {
          resolve();
        } else if (sig) {
          sig.addEventListener("abort", () => resolve());
        }
      });
      yield "Chunk 2";
    }

    vi.mocked(fetchAIResponse).mockImplementation((opts) => {
      receivedSignal = opts.signal ?? null;
      return infiniteStream();
    });

    let processPromise: Promise<void>;
    act(() => {
      processPromise = result.current.processWithAI(
        "Тестовый вопрос 1",
        "System prompt",
        [],
        [],
        "them"
      );
    });

    // Let the generator start
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.isAIProcessing).toBe(true);
    expect(receivedSignal).not.toBeNull();
    const sig = receivedSignal as unknown as AbortSignal;
    expect(sig.aborted).toBe(false);

    act(() => {
      result.current.abortAI();
    });

    expect(sig.aborted).toBe(true);

    await act(async () => {
      await processPromise;
    });

    expect(result.current.isAIProcessing).toBe(false);
  });

  it("throttles streaming UI state updates and updates interactions on finish", async () => {
    const props = createHookProps();
    const { result } = renderHook(() => useAIStreaming(props));

    async function* chunkStream() {
      yield "Hello ";
      yield "world, ";
      yield "this is ";
      yield "streaming AI.";
    }

    vi.mocked(fetchAIResponse).mockReturnValue(chunkStream());

    await act(async () => {
      await result.current.processWithAI(
        "Hello",
        "prompt",
        [],
        [],
        "them"
      );
    });

    expect(addInteraction).toHaveBeenCalledWith(
      "Hello",
      "Hello world, this is streaming AI.",
      "them"
    );
    expect(clearFiller).toHaveBeenCalled();
  });

  it("handles missing AI provider error gracefully", async () => {
    const props = createHookProps();
    props.selectedAIProvider = { provider: "", variables: {} };

    const { result } = renderHook(() => useAIStreaming(props));

    await act(async () => {
      await result.current.processWithAI(
        "Hello",
        "prompt",
        [],
        [],
        "them"
      );
    });

    expect(onError).toHaveBeenCalledWith("No AI provider selected.");
    expect(fetchAIResponse).not.toHaveBeenCalled();
    expect(result.current.isAIProcessing).toBe(false);
  });

  it("consumes and clears pending screenshot attachment", async () => {
    const props = createHookProps();
    props.pendingScreenshotRef.current = "data:image/png;base64,sample";

    const { result } = renderHook(() => useAIStreaming(props));

    async function* emptyStream() {
      yield "Done";
    }
    vi.mocked(fetchAIResponse).mockReturnValue(emptyStream());

    await act(async () => {
      await result.current.processWithAI(
        "Analyze this screenshot",
        "prompt",
        [],
        props.pendingScreenshotRef.current ? [props.pendingScreenshotRef.current] : [],
        "them"
      );
    });

    expect(fetchAIResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        imagesBase64: ["data:image/png;base64,sample"],
      })
    );
    expect(props.setPendingScreenshot).toHaveBeenCalledWith(null);
  });
});
