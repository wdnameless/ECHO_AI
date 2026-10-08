import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SubtitleFeed } from "../SubtitleFeed";
import type { ChatConversation } from "@/hooks/useSystemAudio";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: class {},
}));

const mockOnSetSelectedAIProvider = vi.fn();
const mockAllAiProviders = [
  { id: "openai", curl: 'curl "https://api.openai.com/v1" -d \'{"model":"gpt-4o"}\'' },
  { id: "anthropic", curl: 'curl "https://api.anthropic.com/v1" -d \'{"model":"claude-3-5-sonnet"}\'' },
];

vi.mock("@/contexts", () => ({
  useApp: () => ({
    promptProfiles: [{ id: "interview", name: "Interview" }],
    activeProfileId: "interview",
    selectPromptProfile: vi.fn(),
    selectedAIProvider: { provider: "openai", variables: { model: "gpt-4o" } },
    allAiProviders: mockAllAiProviders,
    onSetSelectedAIProvider: mockOnSetSelectedAIProvider,
  }),
}));

vi.mock("@/lib/version", () => ({
  useAppVersion: () => "1.2.0",
}));

vi.mock("@/lib/fast-translator", () => ({
  fastTranslate: vi.fn().mockResolvedValue("Translated"),
}));

vi.mock("@/lib/metrics", () => ({
  getMetrics: () => ({}),
  onMetrics: () => () => {},
  resetMetrics: vi.fn(),
}));

vi.mock("@/lib/storage/user-facts", () => ({
  recordFeedback: vi.fn(),
  getSelfEvolutionStats: () => ({
    totalEdits: 0,
    likes: 0,
    dislikes: 0,
    tone: "",
    concise: false,
    favoritePatterns: [],
    avoidPatterns: [],
    customRules: [],
  }),
}));

const mockConversation: ChatConversation = {
  id: "conv-1",
  messages: [],
  createdAt: 0,
  updatedAt: 0,
};

describe("R04: SubtitleFeed model badge and provider dropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders model badge with active provider in footer", () => {
    render(
      <SubtitleFeed
        conversation={mockConversation}
        liveSegments={[]}
        lastAIResponse=""
        isAIProcessing={false}
        theirLastTranscription=""
        micSpeaking={false}
        handyOnline={true}
        handyModel="base"
        feedPaused={false}
        onTogglePause={() => {}}
        activeProviderId="openai"
        onSetSelectedAIProvider={mockOnSetSelectedAIProvider}
      />
    );

    const badge = screen.getByTestId("model-badge-dropdown-trigger");
    expect(badge).toBeDefined();
    expect(badge.textContent).toContain("openai");
  });

  it("clicking model badge opens provider selection dropdown and calls onSetSelectedAIProvider", () => {
    render(
      <SubtitleFeed
        conversation={mockConversation}
        liveSegments={[]}
        lastAIResponse=""
        isAIProcessing={false}
        theirLastTranscription=""
        micSpeaking={false}
        handyOnline={true}
        handyModel="base"
        feedPaused={false}
        onTogglePause={() => {}}
        activeProviderId="openai"
        onSetSelectedAIProvider={mockOnSetSelectedAIProvider}
      />
    );

    const badge = screen.getByTestId("model-badge-dropdown-trigger");
    fireEvent.click(badge);

    const anthropicOption = screen.getByTestId("provider-option-anthropic");
    fireEvent.click(anthropicOption);

    expect(mockOnSetSelectedAIProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic" })
    );
  });

  it("syncs active provider across windows via storage event", () => {
    render(
      <SubtitleFeed
        conversation={mockConversation}
        liveSegments={[]}
        lastAIResponse=""
        isAIProcessing={false}
        theirLastTranscription=""
        micSpeaking={false}
        handyOnline={true}
        handyModel="base"
        feedPaused={false}
        onTogglePause={() => {}}
        activeProviderId="openai"
        onSetSelectedAIProvider={mockOnSetSelectedAIProvider}
      />
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "curl_selected_ai_provider",
          newValue: JSON.stringify({ provider: "anthropic", variables: {} }),
        })
      );
    });

    const badge = screen.getByTestId("model-badge-dropdown-trigger");
    expect(badge.textContent).toContain("anthropic");
  });
});
