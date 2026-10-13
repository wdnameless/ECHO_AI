import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeedRow, type FeedRowProps } from "./FeedRow";
import { createRef } from "react";

vi.mock("@/lib/hover-translate", () => ({
  HoverTranslate: ({ text }: { text: string }) => <span>{text}</span>,
}));

function defaultProps(overrides: Partial<FeedRowProps> = {}): FeedRowProps {
  return {
    id: "row-1",
    kind: "me",
    text: "Hello world",
    translationsOn: false,
    translationFailed: false,
    isEditing: false,
    editWrongWord: "",
    editRightWord: "",
    editInputRef: createRef<HTMLInputElement | null>(),
    isSavingCorrection: false,
    showAskAI: false,
    isAskDisabled: false,
    showFillerBelow: false,
    copied: false,
    onCopy: vi.fn(),
    onStartInlineEdit: vi.fn(),
    onCancelInlineEdit: vi.fn(),
    onSaveInlineEdit: vi.fn(),
    onEditRightWordChange: vi.fn(),
    ...overrides,
  };
}

describe("FeedRow", () => {
  it("renders 'me' row with mic icon and 'Вы' badge", () => {
    render(<FeedRow {...defaultProps({ kind: "me", text: "Candidate speech" })} />);
    expect(screen.getByText("Вы")).toBeDefined();
    expect(screen.getByText("Candidate speech")).toBeDefined();
  });

  it("renders 'them' row with 'Собеседник' badge", () => {
    render(<FeedRow {...defaultProps({ kind: "them", text: "Interviewer speech" })} />);
    expect(screen.getByText("Собеседник")).toBeDefined();
    expect(screen.getByText("Interviewer speech")).toBeDefined();
  });

  it("triggers onCopy when copy button is clicked", () => {
    const onCopy = vi.fn();
    render(<FeedRow {...defaultProps({ onCopy, text: "Copy me" })} />);
    const copyBtn = screen.getByTitle("Скопировать");
    fireEvent.click(copyBtn);
    expect(onCopy).toHaveBeenCalledWith("row-1", "Copy me");
  });

  it("triggers onStartInlineEdit when edit button is clicked", () => {
    const onStartInlineEdit = vi.fn();
    render(<FeedRow {...defaultProps({ onStartInlineEdit, text: "Some text" })} />);
    const editBtn = screen.getByLabelText("Исправить");
    fireEvent.click(editBtn);
    expect(onStartInlineEdit).toHaveBeenCalledWith("row-1", "Some text");
  });

  it("renders inline edit input and handles save / cancel", () => {
    const onSaveInlineEdit = vi.fn();
    const onCancelInlineEdit = vi.fn();
    const onEditRightWordChange = vi.fn();

    render(
      <FeedRow
        {...defaultProps({
          isEditing: true,
          editWrongWord: "хелло",
          editRightWord: "hello",
          onSaveInlineEdit,
          onCancelInlineEdit,
          onEditRightWordChange,
        })}
      />
    );

    expect(screen.getByText("хелло")).toBeDefined();
    const input = screen.getByPlaceholderText("Как правильно?");
    expect((input as HTMLInputElement).value).toBe("hello");

    fireEvent.change(input, { target: { value: "hello world" } });
    expect(onEditRightWordChange).toHaveBeenCalledWith("hello world");

    // Press Escape to cancel
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancelInlineEdit).toHaveBeenCalled();

    // Click Save button
    const saveBtn = screen.getByTitle("Сохранить в словарь");
    fireEvent.click(saveBtn);
    expect(onSaveInlineEdit).toHaveBeenCalledWith("Hello world", "хелло", "hello");
  });

  it("renders Ask AI button when showAskAI is true and calls onAskAI", () => {
    const onAskAI = vi.fn().mockResolvedValue(undefined);
    render(
      <FeedRow
        {...defaultProps({
          showAskAI: true,
          onAskAI,
          text: "Question",
        })}
      />
    );
    const askBtn = screen.getByLabelText("Спросить ИИ");
    fireEvent.click(askBtn);
    expect(onAskAI).toHaveBeenCalledWith("row-1", "Question", "me");
  });

  it("renders 'Взять как правило' for 'them' rows and handles click", () => {
    const onTakeAsRule = vi.fn();
    render(
      <FeedRow
        {...defaultProps({
          kind: "them",
          onTakeAsRule,
          text: "Отвечай кратко",
        })}
      />
    );
    const ruleBtn = screen.getByLabelText("Взять как правило");
    fireEvent.click(ruleBtn);
    expect(onTakeAsRule).toHaveBeenCalledWith("row-1", "Отвечай кратко");
  });

  it("renders translation when translationsOn is true", () => {
    render(
      <FeedRow
        {...defaultProps({
          translationsOn: true,
          translation: "Привет мир",
        })}
      />
    );
    expect(screen.getByText("Привет мир")).toBeDefined();
  });

  it("renders translation dash when translationFailed is true", () => {
    render(
      <FeedRow
        {...defaultProps({
          translationsOn: true,
          translation: undefined,
          translationFailed: true,
        })}
      />
    );
    expect(screen.getByTitle("Перевод недоступен")).toBeDefined();
  });

  it("renders active filler when showFillerBelow is true", () => {
    render(
      <FeedRow
        {...defaultProps({
          showFillerBelow: true,
          activeFiller: "Думаю над ответом...",
        })}
      />
    );
    expect(screen.getByText("Думаю над ответом...")).toBeDefined();
  });

  it("renders RulePreview when rulePreviewCandidate is passed", () => {
    const onSaveRulePreview = vi.fn();
    const onCancelRulePreview = vi.fn();
    render(
      <FeedRow
        {...defaultProps({
          rulePreviewCandidate: "Говорить медленнее",
          onSaveRulePreview,
          onCancelRulePreview,
        })}
      />
    );
    expect(screen.getByText("Говорить медленнее")).toBeDefined();
    expect(screen.getByRole("region", { name: "Превью правила" })).toBeDefined();
  });
});
