import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubtitleFeed } from "./SubtitleFeed";
import type { ChatConversation } from "@/hooks/useSystemAudio";

vi.mock("@/contexts", () => ({
  useApp: () => ({
    selectedAIProvider: { provider: "nullform-gateway", variables: {} },
    allAiProviders: [],
    customAiProviders: [],
    promptProfiles: [],
    activeProfileId: "",
    selectPromptProfile: vi.fn(),
  }),
}));

vi.mock("@/lib/version", () => ({
  useAppVersion: () => "1.2.14",
}));

vi.mock("@/lib/fast-translator", () => ({
  fastTranslate: vi.fn().mockResolvedValue("Translated text"),
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

vi.mock("@/lib/web-search", () => ({
  getWebSearchSettings: () => ({ enabled: false }),
  saveWebSearchSettings: vi.fn(),
}));

vi.mock("@/lib/vocab", () => ({
  addCorrection: vi.fn(),
  applyCorrections: (text: string) => text,
}));

const mockConversation: ChatConversation = {
  id: "conv-1",
  title: "Test Conversation",
  messages: [
    {
      id: "msg-1",
      role: "user",
      content: "Hello from candidate",
      timestamp: 1000,
      source: "me",
    },
    {
      id: "msg-2",
      role: "user",
      content: "Can you explain concurrency?",
      timestamp: 2000,
      source: "them",
    },
  ],
  createdAt: 1000,
  updatedAt: 2000,
};

describe("R18: SubtitleFeed streaming isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders committed messages in chronological order", () => {
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
        onTogglePause={vi.fn()}
      />
    );

    expect(screen.getByText("Hello from candidate")).toBeDefined();
    expect(screen.getByText("Can you explain concurrency?")).toBeDefined();
  });

  it("shows filler placeholder when isAIProcessing is true and lastAIResponse is empty", () => {
    render(
      <SubtitleFeed
        conversation={mockConversation}
        liveSegments={[]}
        lastAIResponse=""
        isAIProcessing={true}
        theirLastTranscription=""
        micSpeaking={false}
        handyOnline={true}
        handyModel="base"
        feedPaused={false}
        onTogglePause={vi.fn()}
        activeFiller="Hold on, thinking..."
      />
    );

    expect(screen.getByText("«Hold on, thinking...»")).toBeDefined();
    expect(screen.getByText("Заполните паузу (зачитайте вслух):")).toBeDefined();
  });

  it("renders streaming AI tail separately when tokens arrive without clobbering committed rows", () => {
    const { rerender } = render(
      <SubtitleFeed
        conversation={mockConversation}
        liveSegments={[]}
        lastAIResponse="Concurrency means"
        isAIProcessing={true}
        theirLastTranscription=""
        micSpeaking={false}
        handyOnline={true}
        handyModel="base"
        feedPaused={false}
        onTogglePause={vi.fn()}
      />
    );

    expect(screen.getByText("Concurrency means")).toBeDefined();
    expect(screen.getByText("Hello from candidate")).toBeDefined();

    // Rerender with next token
    rerender(
      <SubtitleFeed
        conversation={mockConversation}
        liveSegments={[]}
        lastAIResponse="Concurrency means multiple tasks making progress"
        isAIProcessing={true}
        theirLastTranscription=""
        micSpeaking={false}
        handyOnline={true}
        handyModel="base"
        feedPaused={false}
        onTogglePause={vi.fn()}
      />
    );

    expect(
      screen.getByText("Concurrency means multiple tasks making progress")
    ).toBeDefined();
    expect(screen.getByText("Hello from candidate")).toBeDefined();
  });
});
