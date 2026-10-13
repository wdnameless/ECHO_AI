import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  SelfEvolutionPopover,
  BehaviorSuggestionBanner,
  EvolutionNoteBanner,
  useFeedPopovers,
  FeedPopovers,
} from "./FeedPopovers";
import type { SelfEvolutionStats } from "@/lib/storage/user-facts";
import type { SmartRule } from "@/lib/storage/smart-rules";
import type { BehaviorSuggestion } from "@/lib/behavior-watch";

vi.mock("@/components/SelfLearningToggle", () => ({
  SelfLearningToggle: () => <div data-testid="self-learning-toggle">SelfLearningToggle</div>,
}));

vi.mock("@/lib/storage/user-facts", () => ({
  getSelfEvolutionStats: vi.fn(() => ({
    totalEdits: 5,
    likes: 4,
    dislikes: 1,
    tone: "деловой",
    concise: true,
    favoritePatterns: ["pattern-1"],
    avoidPatterns: ["pattern-avoid-1"],
    customRules: ["custom-rule-1"],
  })),
  getRuleSource: vi.fn((r: string) => `source:${r}`),
}));

vi.mock("@/lib/storage/smart-rules", () => ({
  getSmartRules: vi.fn(() => []),
  deleteSmartRule: vi.fn(),
  saveSmartRule: vi.fn(),
}));

vi.mock("@/lib/behavior-watch", () => ({
  BEHAVIOR_SUGGESTION_EVENT: "pluely:behavior-suggestion",
  getActiveSuggestions: vi.fn(() => []),
  confirmSuggestion: vi.fn(),
  dismissSuggestion: vi.fn(),
}));

describe("FeedPopovers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SelfEvolutionPopover", () => {
    const dummyStats: SelfEvolutionStats = {
      totalEdits: 3,
      likes: 2,
      dislikes: 1,
      tone: "дружелюбный",
      concise: true,
      favoritePatterns: ["без воды"],
      avoidPatterns: ["сложные термины"],
      customRules: [],
    };

    const dummyRules: SmartRule[] = [
      {
        id: "rule-1",
        text: "отвечай на примерах",
        weight: 1.2,
        hits: 4,
        scope: { kind: "global" },
        createdAt: 1000,
        lastHitAt: null,
        ttlDays: null,
        archived: false,
        origin: { quote: "пример из жизни", source: "feedback", at: 1000 },
      },
    ];

    it("renders brain button trigger with edit count", () => {
      render(<SelfEvolutionPopover stats={dummyStats} />);
      const brainBtn = screen.getByTitle("Что ИИ выучил из ваших оценок");
      expect(brainBtn).toBeInTheDocument();
      expect(brainBtn).toHaveTextContent("🧠");
      expect(brainBtn).toHaveTextContent("3");
    });

    it("renders popover content when open", () => {
      render(
        <SelfEvolutionPopover
          open={true}
          stats={dummyStats}
          smartRules={dummyRules}
        />
      );

      expect(
        screen.getByText(/Self-Evolution · что учтено · всего правок: 3/i)
      ).toBeInTheDocument();
      expect(screen.getByTestId("self-learning-toggle")).toBeInTheDocument();
      expect(screen.getByText(/дружелюбный/i)).toBeInTheDocument();
      expect(screen.getByText(/максимально кратко/i)).toBeInTheDocument();
      expect(screen.getByText(/Эталоны стиля:/i)).toBeInTheDocument();
      expect(screen.getByText(/• без воды/i)).toBeInTheDocument();
      expect(screen.getByText(/Избегать:/i)).toBeInTheDocument();
      expect(screen.getByText(/• сложные термины/i)).toBeInTheDocument();
      expect(screen.getByText(/отвечай на примерах/i)).toBeInTheDocument();
      expect(screen.getByText(/источник: пример из жизни/i)).toBeInTheDocument();
      expect(screen.getByText(/хиты: 4/i)).toBeInTheDocument();
      expect(screen.getByText(/вес: 1.2/i)).toBeInTheDocument();
    });

    it("calls onDeleteSmartRule when rule delete button is clicked", () => {
      const onDeleteSmartRule = vi.fn();
      render(
        <SelfEvolutionPopover
          open={true}
          stats={dummyStats}
          smartRules={dummyRules}
          onDeleteSmartRule={onDeleteSmartRule}
        />
      );

      const delBtn = screen.getByRole("button", {
        name: /Удалить правило отвечай на примерах/i,
      });
      fireEvent.click(delBtn);
      expect(onDeleteSmartRule).toHaveBeenCalledWith("rule-1");
    });

    it("renders custom rules fallback when smart rules are empty", () => {
      const statsWithCustom: SelfEvolutionStats = {
        ...dummyStats,
        customRules: ["всегда отвечать на русском"],
      };

      render(
        <SelfEvolutionPopover
          open={true}
          stats={statsWithCustom}
          smartRules={[]}
        />
      );
      expect(
        screen.getAllByText(/всегда отвечать на русском/i).length
      ).toBeGreaterThan(0);
    });

    it("is aliased as FeedPopovers", () => {
      expect(FeedPopovers).toBe(SelfEvolutionPopover);
    });
  });

  describe("BehaviorSuggestionBanner", () => {
    const dummySuggestions: BehaviorSuggestion[] = [
      {
        id: "sug-1",
        ruleText: "отвечать короче",
        reason: "3 запроса сократить",
        at: 1000,
      },
    ];

    it("renders nothing when suggestions array is empty", () => {
      const { container } = render(
        <BehaviorSuggestionBanner suggestions={[]} />
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders suggestion banner with confirm and dismiss buttons", () => {
      const onConfirm = vi.fn();
      const onDismiss = vi.fn();

      render(
        <BehaviorSuggestionBanner
          suggestions={dummySuggestions}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
        />
      );

      expect(
        screen.getByTestId("behavior-suggestion-sug-1")
      ).toBeInTheDocument();
      expect(screen.getByText(/отвечать короче/i)).toBeInTheDocument();
      expect(screen.getByText(/3 запроса сократить/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /^Да$/i }));
      expect(onConfirm).toHaveBeenCalledWith("sug-1");

      fireEvent.click(screen.getByRole("button", { name: /^Нет$/i }));
      expect(onDismiss).toHaveBeenCalledWith("sug-1");
    });
  });

  describe("EvolutionNoteBanner", () => {
    it("renders nothing when note is null", () => {
      const { container } = render(<EvolutionNoteBanner note={null} />);
      expect(container.firstChild).toBeNull();
    });

    it("renders warning note for disabled self-learning", () => {
      render(<EvolutionNoteBanner note="Самообучение выключено" />);
      expect(screen.getByText("Самообучение выключено")).toBeInTheDocument();
      expect(
        screen.queryByText(/подход изменён для следующего ответа/i)
      ).not.toBeInTheDocument();
    });

    it("renders acknowledgment note with suffix for normal feedback", () => {
      render(<EvolutionNoteBanner note="Стиль закреплён по этому ответу" />);
      expect(
        screen.getByText(/Стиль закреплён по этому ответу/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/подход изменён для следующего ответа/i)
      ).toBeInTheDocument();
    });
  });

  describe("useFeedPopovers hook", () => {
    function HookTestComponent() {
      const {
        evolutionNote,
        showEvolutionNote,
        showBrain,
        handleOpenBrainChange,
        evoStats,
        behaviorSuggestions,
        handleConfirmSuggestion,
        handleDismissSuggestion,
      } = useFeedPopovers();

      return (
        <div>
          <span data-testid="evo-note">{evolutionNote ?? "none"}</span>
          <span data-testid="show-brain">{showBrain ? "open" : "closed"}</span>
          <span data-testid="evo-edits">{evoStats.totalEdits}</span>
          <span data-testid="suggestions-count">{behaviorSuggestions.length}</span>
          <button onClick={() => showEvolutionNote("Тестовая заметка")}>
            Trigger Note
          </button>
          <button onClick={() => handleOpenBrainChange(true)}>
            Open Brain
          </button>
          <button onClick={() => handleConfirmSuggestion("sug-test")}>
            Confirm Sug
          </button>
          <button onClick={() => handleDismissSuggestion("sug-test")}>
            Dismiss Sug
          </button>
        </div>
      );
    }

    it("manages evolution note and brain open state", () => {
      render(<HookTestComponent />);

      expect(screen.getByTestId("evo-note")).toHaveTextContent("none");
      expect(screen.getByTestId("show-brain")).toHaveTextContent("closed");

      fireEvent.click(screen.getByText("Trigger Note"));
      expect(screen.getByTestId("evo-note")).toHaveTextContent("Тестовая заметка");

      fireEvent.click(screen.getByText("Open Brain"));
      expect(screen.getByTestId("show-brain")).toHaveTextContent("open");
    });
  });
});
