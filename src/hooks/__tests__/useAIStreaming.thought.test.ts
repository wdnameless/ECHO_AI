import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAIStreaming, SelectedAIProviderConfig } from "../useAIStreaming";
import type { ChatConversation } from "../useConversationStore";
import { fetchAIResponse, shouldUsePluelyAPI } from "@/lib/functions";
import { setAnswerMode } from "@/lib/answer-mode";
import { safeLocalStorage } from "@/lib/storage/helper";
import { THOUGHT_TRACE_PROMPT } from "@/lib/functions/ai-response.function";
import type { TYPE_PROVIDER } from "@/types";

vi.mock("@/lib/functions", () => ({
  fetchAIResponse: vi.fn(),
  shouldUsePluelyAPI: vi.fn(),
}));

vi.mock("@/lib/metrics", () => ({
  startQuestion: vi.fn(),
  recordFirstToken: vi.fn(),
}));

describe("R01: useAIStreaming thought branch", () => {
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
    title: "Test",
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
    safeLocalStorage.clear();
    setAnswerMode("interview");
    vi.mocked(shouldUsePluelyAPI).mockResolvedValue(false);
    async function* emptyStream() {
      yield "answer";
    }
    vi.mocked(fetchAIResponse).mockReturnValue(emptyStream());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createHookProps() {
    return {
      selectedAIProvider: defaultSelectedProvider,
      allAiProviders: defaultAllProviders,
      systemPrompt: "Base prompt for candidate",
      useSystemPrompt: true,
      contextContent: "",
      conversation: defaultConversation,
      buildHistory,
      addInteraction,
      setFillerForInterviewer,
      clearFiller,
      getActiveFiller,
      pendingUtteranceId: null as string | null,
      pendingScreenshotRef: { current: null as string | null },
      setPendingScreenshot,
      onError,
    };
  }

  it("does not inject thought block into prompt when mode is interview", async () => {
    setAnswerMode("interview");
    const props = createHookProps();
    const { result } = renderHook(() => useAIStreaming(props));

    await act(async () => {
      await result.current.triggerAIForQuestion("What is optimistic concurrency?", "them");
    });

    expect(fetchAIResponse).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(fetchAIResponse).mock.calls[0][0];
    expect(callArgs.systemPrompt).not.toContain("THOUGHT-TRACE MODE");
    expect(callArgs.mode).toBe("interview");
  });

  it("injects thought block into prompt and passes thought mode when mode is thought", async () => {
    setAnswerMode("thought");
    const props = createHookProps();
    const { result } = renderHook(() => useAIStreaming(props));

    await act(async () => {
      await result.current.triggerAIForQuestion("What is optimistic concurrency?", "them");
    });

    expect(fetchAIResponse).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(fetchAIResponse).mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain(THOUGHT_TRACE_PROMPT);
    expect(callArgs.mode).toBe("thought");
  });
});
