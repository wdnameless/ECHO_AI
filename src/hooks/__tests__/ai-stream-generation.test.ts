import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAIStreaming } from "../useAIStreaming";

vi.mock("@/lib/functions", () => ({
  fetchAIResponse: vi.fn(),
  shouldUsePluelyAPI: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/metrics", () => ({ startQuestion: vi.fn(), recordFirstToken: vi.fn() }));

import { fetchAIResponse } from "@/lib/functions";

describe("generation guard does not swallow the last completion", () => {
  it("settles isAIProcessing after the newest stream finishes", async () => {
    const onProcessingComplete = vi.fn();
    vi.mocked(fetchAIResponse).mockReturnValue((async function* () { yield "готово"; })() as never);
    const props = {
      selectedAIProvider: { provider: "openai", variables: { model: "gpt-4o" } },
      allAiProviders: [{ id: "openai", curl: "curl -X POST https://api.openai.com/v1/chat/completions", streaming: true }],
      systemPrompt: "s", contextContent: "", useSystemPrompt: true,
      conversation: { id: "c", title: "t", messages: [], createdAt: 1, updatedAt: 1 },
      buildHistory: vi.fn(() => []), addInteraction: vi.fn(),
      setFillerForInterviewer: vi.fn(), clearFiller: vi.fn(),
      pendingUtteranceId: null, onError: vi.fn(),
      pendingScreenshotRef: { current: null }, setPendingScreenshot: vi.fn(),
      onProcessingComplete,
    };
    const { result } = renderHook(() => useAIStreaming(props as never));

    await act(async () => {
      await result.current.processWithAI("в", "p", [], [], "them");
    });

    // Ключевое: последний поток обязан снять флаг и отпустить удержанное.
    expect(result.current.isAIProcessing).toBe(false);
    expect(onProcessingComplete).toHaveBeenCalledTimes(1);
  });
});
