import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  AICard,
  type AICardProps,
  splitThoughtAnswer,
  answerForCopy,
  splitCodeForCopy,
  ThoughtContainer,
  DISLIKE_REASONS,
} from "./AICard";

function defaultProps(overrides: Partial<AICardProps> = {}): AICardProps {
  return {
    id: "ai-1",
    text: "AI answer text",
    translationsOn: false,
    translationFailed: false,
    copied: false,
    isDislikeOpen: false,
    customReason: "",
    onCopy: vi.fn(),
    onFeedback: vi.fn(),
    onToggleDislike: vi.fn(),
    onCustomReasonChange: vi.fn(),
    ...overrides,
  };
}

describe("AICard", () => {
  describe("parsers and helpers", () => {
    it("splitThoughtAnswer parses thought and answer", () => {
      const res = splitThoughtAnswer("<thought>deep thinking</thought>spoken answer");
      expect(res.thought).toBe("deep thinking");
      expect(res.answer).toBe("spoken answer");
    });

    it("answerForCopy strips thought block", () => {
      expect(answerForCopy("<thought>internal</thought>external")).toBe("external");
      expect(answerForCopy("pure text")).toBe("pure text");
    });

    it("splitCodeForCopy extracts code snippet", () => {
      const codeText = "Here is code:\n```typescript\nconst x = 1;\n```\nExplanation";
      expect(splitCodeForCopy(codeText)).toBe("const x = 1;");
    });
  });

  describe("Rendering", () => {
    it("renders AI badge and text", () => {
      render(<AICard {...defaultProps({ text: "Hello from AI" })} />);
      expect(screen.getByText("Ответ ИИ")).toBeDefined();
      expect(screen.getByText("Hello from AI")).toBeDefined();
    });

    it("renders ThoughtContainer when thought tags are present", () => {
      render(
        <AICard
          {...defaultProps({
            text: "<thought>Analyzing problem</thought>Final solution",
          })}
        />
      );
      expect(screen.getByTestId("thought-container")).toBeDefined();
      expect(screen.getByText("Ход мыслей")).toBeDefined();
      expect(screen.getByText("Analyzing problem")).toBeDefined();
      expect(screen.getByText("Final solution")).toBeDefined();
    });

    it("ThoughtContainer renders standalone", () => {
      render(<ThoughtContainer thought="Standalone thought" />);
      expect(screen.getByTestId("thought-container")).toBeDefined();
      expect(screen.getByText("Standalone thought")).toBeDefined();
    });

    it("calls onCopy with spoken answer when copy button clicked", () => {
      const onCopy = vi.fn();
      render(
        <AICard
          {...defaultProps({
            onCopy,
            text: "<thought>private</thought>public answer",
          })}
        />
      );
      const copyBtn = screen.getByTitle("Скопировать ответ");
      fireEvent.click(copyBtn);
      expect(onCopy).toHaveBeenCalledWith("ai-1", "public answer");
    });

    it("calls onFeedback with like rating", () => {
      const onFeedback = vi.fn();
      render(<AICard {...defaultProps({ onFeedback, text: "Good answer" })} />);
      const likeBtn = screen.getByTitle("Лайк: закрепить стиль ответа");
      fireEvent.click(likeBtn);
      expect(onFeedback).toHaveBeenCalledWith("ai-1", "Good answer", "like");
    });

    it("calls onToggleDislike when dislike button clicked", () => {
      const onToggleDislike = vi.fn();
      render(<AICard {...defaultProps({ onToggleDislike })} />);
      const dislikeBtn = screen.getByTitle("Дизлайк: указать, что улучшить");
      fireEvent.click(dislikeBtn);
      expect(onToggleDislike).toHaveBeenCalledWith("ai-1");
    });

    it("renders dislike reasons when isDislikeOpen is true and handles selection", () => {
      const onFeedback = vi.fn();
      render(
        <AICard
          {...defaultProps({
            isDislikeOpen: true,
            onFeedback,
            text: "Bad answer",
          })}
        />
      );
      expect(screen.getByText("Что улучшить в ответах?")).toBeDefined();
      const firstReason = DISLIKE_REASONS[0];
      const reasonBtn = screen.getByRole("button", { name: firstReason });
      fireEvent.click(reasonBtn);
      expect(onFeedback).toHaveBeenCalledWith("ai-1", "Bad answer", "dislike", firstReason);
    });

    it("handles custom dislike reason submission", () => {
      const onFeedback = vi.fn();
      const onCustomReasonChange = vi.fn();
      render(
        <AICard
          {...defaultProps({
            isDislikeOpen: true,
            customReason: "Too formal",
            onFeedback,
            onCustomReasonChange,
            text: "Verbose answer",
          })}
        />
      );
      const submitBtn = screen.getByTitle("Отправить");
      fireEvent.click(submitBtn);
      expect(onFeedback).toHaveBeenCalledWith("ai-1", "Verbose answer", "dislike", "Too formal");
    });

    it("renders deepen button when onDeepen is provided", () => {
      const onDeepen = vi.fn();
      render(<AICard {...defaultProps({ onDeepen })} />);
      const deepenBtn = screen.getByTitle("Углубить эту тему: продолжить рассказ");
      fireEvent.click(deepenBtn);
      expect(onDeepen).toHaveBeenCalledTimes(1);
    });

    it("renders feedback status message when feedback is provided", () => {
      const { rerender } = render(<AICard {...defaultProps({ feedback: "like" })} />);
      expect(screen.getByText("паттерн усвоен")).toBeDefined();
      expect(screen.queryByTitle("Лайк: закрепить стиль ответа")).toBeNull();

      rerender(<AICard {...defaultProps({ feedback: "dislike" })} />);
      expect(screen.getByText("учтено")).toBeDefined();
    });

    it("hides feedback and deepen buttons during streaming", () => {
      const onDeepen = vi.fn();
      render(<AICard {...defaultProps({ streaming: true, onDeepen })} />);
      expect(screen.queryByTitle("Лайк: закрепить стиль ответа")).toBeNull();
      expect(screen.queryByTitle("Углубить эту тему: продолжить рассказ")).toBeNull();
    });

    it("renders translation when enabled", () => {
      render(
        <AICard
          {...defaultProps({
            translationsOn: true,
            translation: "Переведенный ответ",
          })}
        />
      );
      expect(screen.getByText("Переведенный ответ")).toBeDefined();
    });

    it("renders translation dash when failed", () => {
      render(
        <AICard
          {...defaultProps({
            translationsOn: true,
            translation: undefined,
            translationFailed: true,
          })}
        />
      );
      expect(screen.getByTitle("Перевод недоступен")).toBeDefined();
    });
  });
});
