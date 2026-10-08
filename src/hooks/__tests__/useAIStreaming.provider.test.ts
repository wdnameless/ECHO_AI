import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAIStreaming } from "../useAIStreaming";

vi.mock("@/lib/functions", () => ({
  fetchAIResponse: vi.fn(),
  shouldUsePluelyAPI: () => false,
}));

vi.mock("@/lib/speech-filter", () => ({
  shouldTriggerAIResponse: () => true,
}));

vi.mock("@/lib/metrics", () => ({
  startQuestion: vi.fn(),
  recordFirstToken: vi.fn(),
}));

describe("R04: useAIStreaming activeProviderId export and sync", () => {
  const createProps = (provider = "openai") => ({
    selectedAIProvider: { provider, variables: {} },
    allAiProviders: [
      { id: "openai", curl: "" },
      { id: "anthropic", curl: "" },
    ],
    systemPrompt: "test",
    useSystemPrompt: true,
    contextContent: "",
    conversation: { id: "1", title: "Test", messages: [], createdAt: 0, updatedAt: 0 },
    buildHistory: () => [],
    addInteraction: vi.fn(),
    setFillerForInterviewer: vi.fn(),
    clearFiller: vi.fn(),
    getActiveFiller: () => null,
    pendingUtteranceId: null,
    pendingScreenshotRef: { current: null as string | null },
    setPendingScreenshot: vi.fn(),
    onError: vi.fn(),
  });

  it("exports activeProviderId initialized to selectedAIProvider.provider", () => {
    const { result } = renderHook(() => useAIStreaming(createProps("openai")));
    expect(result.current.activeProviderId).toBe("openai");
  });

  it("updates activeProviderId when selectedAIProvider.provider prop updates", () => {
    let currentProvider = "openai";
    const { result, rerender } = renderHook(
      ({ provider }: { provider: string }) => useAIStreaming(createProps(provider)),
      { initialProps: { provider: currentProvider } }
    );

    expect(result.current.activeProviderId).toBe("openai");

    act(() => {
      rerender({ provider: "anthropic" });
    });

    expect(result.current.activeProviderId).toBe("anthropic");
  });
});
