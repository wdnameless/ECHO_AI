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
    expect(result.current.lastAIResponse).toBe("Hello world, this is streaming AI.");
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
  it.each(["chunk", "error"])("rejects stale %s, events, history and completion callbacks", async (staleResult) => {
    let releaseOld!: () => void;
    let finishNew!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const newGate = new Promise<void>((resolve) => { finishNew = resolve; });
    vi.mocked(fetchAIResponse).mockImplementation((opts) => (async function* () {
      if (opts.userMessage === "old") {
        yield "old partial";
        await oldGate;
        opts.onEvent?.({ type: "restart", providerId: "stale" });
        opts.onEvent?.({ type: "stalled", providerId: "stale" });
        if (staleResult === "chunk") yield "stale token";
        else throw new Error("stale failure");
      }
      yield "new partial";
      await newGate;
      yield " final";
    })());
    const onProcessingComplete = vi.fn();
    const props = { ...createHookProps(), onProcessingComplete };
    const { result } = renderHook(() => useAIStreaming(props));
    let old!: Promise<void>;
    let newest!: Promise<void>;
    await act(async () => { old = result.current.processWithAI("old", "prompt", []); });
    await act(async () => { newest = result.current.processWithAI("new", "prompt", []); });
    const fillerCalls = clearFiller.mock.calls.length;
    await act(async () => { releaseOld(); await old; });
    expect(result.current.isAIProcessing).toBe(true);
    expect(result.current.isStalled).toBe(false);
    expect(result.current.aiStatusMessage).toBe("");
    expect(addInteraction).not.toHaveBeenCalled();
    expect(onProcessingComplete).not.toHaveBeenCalled();
    expect(clearFiller).toHaveBeenCalledTimes(fillerCalls);
    expect(onError.mock.calls).toEqual([[""], [""]]);
    await act(async () => { finishNew(); await newest; });
    expect(result.current.lastAIResponse).toBe("new partial final");
    expect(addInteraction.mock.calls).toEqual([["new", "new partial final", undefined]]);
    expect(onProcessingComplete).toHaveBeenCalledTimes(1);
  });

  it("cannot consume a screenshot or start transport after superseded provider validation", async () => {
    let release!: (value: boolean) => void;
    vi.mocked(shouldUsePluelyAPI).mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    vi.mocked(fetchAIResponse).mockReturnValue((async function* () { yield "new answer"; })());
    const props = createHookProps();
    const { result } = renderHook(() => useAIStreaming(props));
    let old!: Promise<void>;
    act(() => { old = result.current.processWithAI("old", "prompt", []); });
    await act(async () => { await result.current.processWithAI("new", "prompt", []); });
    props.pendingScreenshotRef.current = "new screenshot";
    await act(async () => { release(false); await old; });
    expect(props.pendingScreenshotRef.current).toBe("new screenshot");
    expect(fetchAIResponse).toHaveBeenCalledTimes(1);
    expect(result.current.lastAIResponse).toBe("new answer");
    expect(addInteraction.mock.calls).toEqual([["new", "new answer", undefined]]);
  });

  it("keeps partial content while waiting silently and replaces it on provider restart", async () => {
    let resume!: () => void;
    let resumeFallback!: () => void;
    const pause = new Promise<void>((resolve) => { resume = resolve; });
    const fallbackPause = new Promise<void>((resolve) => { resumeFallback = resolve; });
    vi.mocked(fetchAIResponse).mockImplementation((opts) => (async function* () {
      opts.onEvent?.({ type: "attempt", providerId: "openai" });
      yield "broken partial";
      opts.onEvent?.({ type: "stalled", providerId: "openai" });
      await pause;
      opts.onEvent?.({ type: "restart", providerId: "anthropic" });
      opts.onEvent?.({ type: "attempt", providerId: "anthropic" });
      await fallbackPause;
      yield "replacement";
    })());
    const props = createHookProps();
    const { result } = renderHook(() => useAIStreaming(props));
    let stream!: Promise<void>;
    await act(async () => { stream = result.current.processWithAI("question", "prompt", []); });
    expect(result.current.lastAIResponse).toBe("broken partial");
    expect(result.current.isStalled).toBe(true);
    act(() => { result.current.stallWait(); });
    expect(result.current.isStalled).toBe(false);
    expect(result.current.aiStatusMessage).toBe("");
    expect(result.current.isAIProcessing).toBe(true);
    expect(result.current.lastAIResponse).toBe("broken partial");
    expect(fetchAIResponse).toHaveBeenCalledTimes(1);
    await act(async () => { resume(); });
    expect(result.current.lastAIResponse).toBe("");
    expect(result.current.aiStatusMessage).toContain("anthropic");
    await act(async () => { resumeFallback(); await stream; });
    expect(result.current.lastAIResponse).toBe("replacement");
    expect(addInteraction.mock.calls).toEqual([["question", "replacement", undefined]]);
  });

  it("Retry repeats active fallback; repeated Other advances without changing global selection", async () => {
    const gates: (() => void)[] = [];
    vi.mocked(fetchAIResponse).mockImplementation((opts) => (async function* () {
      const providerId = gates.length === 0 ? "anthropic" : opts.provider?.id || "";
      opts.onEvent?.({ type: "attempt", providerId });
      opts.onEvent?.({ type: "stalled", providerId });
      await new Promise<void>((resolve) => { gates.push(resolve); });
      if (!opts.signal?.aborted) yield providerId;
    })());
    const props = createHookProps();
    props.allAiProviders = ["openai", "anthropic", "gemini"].map((id) => ({ id, curl: "" }));
    const { result } = renderHook(() => useAIStreaming(props));
    let initial!: Promise<void>;
    await act(async () => { initial = result.current.processWithAI("question", "prompt", []); });
    expect(result.current.stallNextId).toBe("gemini");
    await act(async () => { result.current.stallRetry(); });
    expect(vi.mocked(fetchAIResponse).mock.calls[1][0].provider?.id).toBe("anthropic");
    await act(async () => { result.current.stallNext(); });
    expect(vi.mocked(fetchAIResponse).mock.calls[2][0].provider?.id).toBe("gemini");
    expect(result.current.stallNextId).toBe("openai");
    await act(async () => { result.current.stallNext(); });
    expect(vi.mocked(fetchAIResponse).mock.calls[3][0].provider?.id).toBe("openai");
    expect(result.current.stallNextId).toBe("anthropic");
    expect(props.selectedAIProvider.provider).toBe("openai");
    await act(async () => { result.current.abortAI(); gates.forEach((resolve) => resolve()); await initial; });
    expect(addInteraction).not.toHaveBeenCalled();
  });

  it("does not commit a partial answer when the final provider fails", async () => {
    vi.mocked(fetchAIResponse).mockReturnValue((async function* () {
      yield "unfinished";
      throw new Error("provider failed after partial");
    })());
    const props = createHookProps();
    const { result } = renderHook(() => useAIStreaming(props));
    await act(async () => { await result.current.processWithAI("question", "prompt", []); });
    expect(result.current.lastAIResponse).toBe("unfinished");
    expect(onError).toHaveBeenLastCalledWith("provider failed after partial");
    expect(addInteraction).not.toHaveBeenCalled();
  });
});
