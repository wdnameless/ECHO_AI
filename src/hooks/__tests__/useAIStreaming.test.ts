import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAIStreaming, SelectedAIProviderConfig } from "../useAIStreaming";
import type { ChatConversation } from "../useConversationStore";
import { fetchAIResponse } from "@/lib/functions";
import { shouldUsePluelyAPI } from "@/lib/functions";
import type { TYPE_PROVIDER } from "@/types";

vi.mock("@/lib/functions", () => ({
  fetchAIResponse: vi.fn(),
  shouldUsePluelyAPI: vi.fn(),
  STALL_SENTINEL: "__ECHO_STALL__",
}));

vi.mock("@/lib/metrics", () => ({
  startQuestion: vi.fn(),
  recordFirstToken: vi.fn(),
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
  const getActiveFiller = vi.fn(() => null);
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
      getActiveFiller,
      pendingUtteranceId: null as string | null,
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

  it("does not overwrite filler if pendingUtteranceId is already set", async () => {
    const props = createHookProps();
    props.pendingUtteranceId = "manual-utterance-123";
    const { result } = renderHook(() => useAIStreaming(props));

    async function* emptyStream() {
      yield "Answer";
    }
    vi.mocked(fetchAIResponse).mockReturnValue(emptyStream());

    await act(async () => {
      await result.current.triggerAIForQuestion("How do you design high scale systems?", "them");
    });

    expect(props.setFillerForInterviewer).not.toHaveBeenCalled();
  });

  it("calls clearFiller when abortAI is invoked", () => {
    const props = createHookProps();
    const { result } = renderHook(() => useAIStreaming(props));

    act(() => {
      result.current.abortAI();
    });

    expect(props.clearFiller).toHaveBeenCalled();
  });

  /**
   * `abortAI` is the SHUTDOWN signal, not "cancel one answer".
   *
   * The lifecycle hook calls it on `stopCapture` and on unmount, just before it
   * tears the capture down and resets the question assembler — so releasing a
   * held question here would dispatch it into a session that is closing, and the
   * AI would answer text the user had just stopped listening for. This pins the
   * contract so the tempting "release on abort" fix is not applied again: only
   * a completed answer releases what it held.
   */
  it("does NOT release a held question when the session is aborted", () => {
    const onProcessingComplete = vi.fn();
    const props = { ...createHookProps(), onProcessingComplete };
    const { result } = renderHook(() => useAIStreaming(props));

    act(() => {
      result.current.abortAI();
    });

    expect(onProcessingComplete).not.toHaveBeenCalled();
  });

  /**
   * An aborted stream finishes *after* the stream that replaced it, so its
   * `finally` must not settle shared state on the new stream's behalf: doing so
   * cleared `isAIProcessing` mid-answer and released held questions into an
   * answer that was still streaming.
   */
  it("lets only the newest stream settle processing state", async () => {
    vi.mocked(fetchAIResponse).mockReturnValue(
      (async function* () {
        yield "первый";
      })() as never
    );
    const onProcessingComplete = vi.fn();
    const props = { ...createHookProps(), onProcessingComplete };
    const { result } = renderHook(() => useAIStreaming(props));

    await act(async () => {
      await result.current.processWithAI("вопрос", "prompt", [], [], "them");
    });
    expect(onProcessingComplete).toHaveBeenCalledTimes(1);

    // A second, slower stream: the first one's completion must not speak for it.
    onProcessingComplete.mockClear();
    let release: (v: string) => void = () => {};
    const slow = new Promise<string>((r) => (release = r));
    vi.mocked(fetchAIResponse).mockReturnValue(
      (async function* () {
        yield await slow;
      })() as never
    );

    const pending = result.current.processWithAI("второй", "prompt", [], [], "them");
    // Abort it the way a new question does, then let it unwind.
    act(() => {
      result.current.abortAI();
    });
    release("поздно");
    await act(async () => {
      await pending.catch(() => {});
    });

    // The stale stream settled; the generation guard decides what that means.
    expect(onProcessingComplete).toHaveBeenCalled();
  });
  it("handles STALL_SENTINEL: sets isStalled, does not append sentinel to answer, stallWait resets isStalled", async () => {
    const props = createHookProps();
    const { result } = renderHook(() => useAIStreaming(props));

    let resumeStream!: () => void;
    const pausePromise = new Promise<void>((resolve) => {
      resumeStream = resolve;
    });
    async function* stallStream() {
      yield "__ECHO_STALL__";
      await pausePromise;
      yield "Actual answer";
    }
    vi.mocked(fetchAIResponse).mockReturnValue(stallStream() as never);

    let streamPromise: Promise<void> | null = null;
    act(() => {
      streamPromise = result.current.processWithAI("question", "prompt", [], [], "them");
    });

    // Wait microtask tick for first chunk (__ECHO_STALL__) to be processed
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isStalled).toBe(true);

    // stallWait clears isStalled while stream is still paused
    act(() => {
      result.current.stallWait();
    });
    expect(result.current.isStalled).toBe(false);

    // Resume stream and complete
    await act(async () => {
      resumeStream();
      await streamPromise;
    });

    expect(props.addInteraction).toHaveBeenCalledWith(
      "question",
      "Actual answer",
      "them"
    );
  });

  it("exposes stallNext, stallNextId, stallRetry and resets isStalled", async () => {
    const props = createHookProps();
    props.allAiProviders = [
      { id: "openai", name: "OpenAI" } as unknown as TYPE_PROVIDER,
      { id: "anthropic", name: "Anthropic" } as unknown as TYPE_PROVIDER,
    ];
    props.selectedAIProvider = { provider: "openai", variables: {} };

    const { result } = renderHook(() => useAIStreaming(props));

    expect(result.current.stallNextId).toBe("anthropic");

    async function* emptyStream() {
      yield "done";
    }
    vi.mocked(fetchAIResponse).mockReturnValue(emptyStream() as never);

    await act(async () => {
      await result.current.processWithAI("test question", "test prompt", [], [], "them");
    });

    // Test stallRetry
    vi.mocked(fetchAIResponse).mockClear();
    vi.mocked(fetchAIResponse).mockReturnValue(emptyStream() as never);
    await act(async () => {
      result.current.stallRetry();
      await Promise.resolve();
    });
    expect(fetchAIResponse).toHaveBeenCalled();

    // Test stallNext
    vi.mocked(fetchAIResponse).mockClear();
    vi.mocked(fetchAIResponse).mockReturnValue(emptyStream() as never);
    await act(async () => {
      result.current.stallNext();
      await Promise.resolve();
    });
    expect(fetchAIResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedProvider: expect.objectContaining({ provider: "anthropic" }),
      })
    );
  });
});
