import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  SubtitleFeed,
  splitThoughtAnswer,
  ThoughtContainer,
} from "../SubtitleFeed";
import type { ChatConversation } from "@/hooks/useConversationStore";

const invokeMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock, Channel: class {} }));
vi.mock("@/lib/metrics", () => ({
  getMetrics: () => ({}),
  onMetrics: () => () => {},
  resetMetrics: vi.fn(),
  buildMetricsDump: () => "",
}));
vi.mock("@/lib/fast-translator", () => ({
  fastTranslate: vi.fn(async (text: string) => `trans:${text}`),
}));
vi.mock("@/contexts", () => ({
  useApp: () => ({
    promptProfiles: [{ id: "default", name: "Default" }],
    activeProfileId: "default",
    selectPromptProfile: vi.fn(),
    selectedAIProvider: { provider: "mock", variables: {} },
    allAiProviders: [],
  }),
}));

const mockConversation: ChatConversation = {
  id: "conv-1",
  title: "Thought Test",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [],
};

describe("R01: SubtitleFeed thought container and parser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("splitThoughtAnswer parser", () => {
    it("extracts closed thought block and spoken answer", () => {
      const input =
        "<thought>\nОпираюсь на паттерн CQRS из-за высоких нагрузок на чтение.\n</thought>\nДля решения задачи разделим модели чтения и записи.";
      const { thought, answer } = splitThoughtAnswer(input);
      expect(thought).toBe(
        "Опираюсь на паттерн CQRS из-за высоких нагрузок на чтение."
      );
      expect(answer).toBe("Для решения задачи разделим модели чтения и записи.");
    });

    it("handles unclosed thought tag during live streaming", () => {
      const input = "<thought>Рассматриваю распределённые транзакции";
      const { thought, answer } = splitThoughtAnswer(input);
      expect(thought).toBe("Рассматриваю распределённые транзакции");
      expect(answer).toBe("");
    });

    it("returns null thought when no thought tag is present", () => {
      const input = "Обычный ответ кандидата на собеседовании.";
      const { thought, answer } = splitThoughtAnswer(input);
      expect(thought).toBeNull();
      expect(answer).toBe(input);
    });

    it("preserves code block inside the answer after thought block", () => {
      const input =
        "<thought>Используем бинарный поиск.</thought>\n```python\ndef search(): pass\n```\nСложность O(log N).";
      const { thought, answer } = splitThoughtAnswer(input);
      expect(thought).toBe("Используем бинарный поиск.");
      expect(answer).toContain("```python");
      expect(answer).toContain("Сложность O(log N).");
    });
  });

  describe("Rendering thought container in feed", () => {
    it("renders ThoughtContainer component directly with correct styling", () => {
      render(
        <ThoughtContainer thought="Рассматриваю компромиссы между latency и throughput." />
      );
      expect(screen.getByTestId("thought-container")).toBeDefined();
      expect(screen.getByText("Ход мыслей")).toBeDefined();
      expect(
        screen.getByText(
          "Рассматриваю компромиссы между latency и throughput."
        )
      ).toBeDefined();
    });

    it("renders thought container inline in streaming AI row", () => {
      const streamingResponse =
        "<thought>Объясняю принцип работы garbage collector.</thought>В V8 используется поколенческая сборка мусора.";

      render(
        <SubtitleFeed
          conversation={mockConversation}
          liveSegments={[]}
          lastAIResponse={streamingResponse}
          isAIProcessing={true}
          theirLastTranscription="Как устроен GC?"
          micSpeaking={false}
          handyOnline={true}
          handyModel="base"
          feedPaused={false}
          onTogglePause={vi.fn()}
        />
      );

      expect(screen.getByTestId("thought-container")).toBeDefined();
      expect(
        screen.getByText("Объясняю принцип работы garbage collector.")
      ).toBeDefined();
      expect(
        screen.getByText("В V8 используется поколенческая сборка мусора.")
      ).toBeDefined();
    });

    it("renders thought container inline in committed conversation message", () => {
      const convWithThought: ChatConversation = {
        ...mockConversation,
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "Расскажи про шардинг.",
            timestamp: 1000,
          },
          {
            id: "msg-2",
            role: "assistant",
            content: "<thought>Шардинг нужен при исчерпании вертикального масштабирования.</thought>Шардирование делит данные по ключу шардирования между узлами.",
            timestamp: 2000,
          },
        ],
      };

      render(
        <SubtitleFeed
          conversation={convWithThought}
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

      expect(screen.getByTestId("thought-container")).toBeDefined();
      expect(
        screen.getByText(
          "Шардинг нужен при исчерпании вертикального масштабирования."
        )
      ).toBeDefined();
      expect(
        screen.getByText(
          "Шардирование делит данные по ключу шардирования между узлами."
        )
      ).toBeDefined();
    });

    it("does not render thought container for ordinary answers without thought tag", () => {
      const convNormal: ChatConversation = {
        ...mockConversation,
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            content: "Обычный ответ без хода мыслей.",
            timestamp: 2000,
          },
        ],
      };

      render(
        <SubtitleFeed
          conversation={convNormal}
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

      expect(screen.queryByTestId("thought-container")).toBeNull();
      expect(
        screen.getByText("Обычный ответ без хода мыслей.")
      ).toBeDefined();
    });
  });
});
