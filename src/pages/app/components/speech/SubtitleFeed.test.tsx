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

/**
 * The report from the running app: the interviewer's line appeared twice, the
 * second time as the opening of a longer row.
 *
 * The recogniser is handed the audio of the whole utterance, so its next final
 * re-reads the clause already on screen — and the feed's merge only compares a
 * row with its immediate predecessor, which an AI answer always sits between.
 * Measured on the stored conversations: 188 of 316 adjacent interviewer turns
 * (59%) contained the previous one verbatim.
 */
describe("a repeated interviewer line is shown once", () => {
  const question = "Вы с ней сговорились?";
  const repeated =
    "Вы с ней сговорились? Yeah. Это из-за вас, Суд Джином, никто не общается.";

  it("does not repeat the committed question inside the next row", () => {
    const conversation: ChatConversation = {
      id: "conv-repeat",
      title: "",
      createdAt: 0,
      updatedAt: 0,
      messages: [
        { id: "m1", role: "user", content: question, timestamp: 1000, source: "them" },
        {
          id: "m2",
          role: "assistant",
          content: "Ну, повесить всех собак на меня — это самый простой путь",
          timestamp: 1010,
        },
      ],
    };
    const { container } = render(
      <SubtitleFeed
        conversation={conversation}
        liveSegments={[
          { id: "L1", source: "them", text: repeated, timestamp: 2000, partial: false },
        ]}
        lastAIResponse=""
        isAIProcessing={false}
        theirLastTranscription=""
        micSpeaking={false}
        handyOnline={true}
        handyModel="parakeet"
        feedPaused={false}
        onTogglePause={vi.fn()}
      />
    );

    // The repeated clause must reach the screen once, not once per row.
    const shown = (container.textContent || "").split("сговорились").length - 1;
    expect(shown).toBe(1);
  });

  it("still shows two genuinely different turns", () => {
    const conversation: ChatConversation = {
      id: "conv-distinct",
      title: "",
      createdAt: 0,
      updatedAt: 0,
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Что это за шрифт? Такой броский.",
          timestamp: 1000,
          source: "them",
        },
      ],
    };
    const { container } = render(
      <SubtitleFeed
        conversation={conversation}
        liveSegments={[
          {
            id: "L1",
            source: "them",
            text: "Совершенно другой вопрос про архитектуру",
            timestamp: 2000,
            partial: false,
          },
        ]}
        lastAIResponse=""
        isAIProcessing={false}
        theirLastTranscription=""
        micSpeaking={false}
        handyOnline={true}
        handyModel="parakeet"
        feedPaused={false}
        onTogglePause={vi.fn()}
      />
    );

    const text = container.textContent || "";
    expect(text).toContain("Что это за шрифт? Такой броский.");
    expect(text).toContain("Совершенно другой вопрос про архитектуру");
  });
});
