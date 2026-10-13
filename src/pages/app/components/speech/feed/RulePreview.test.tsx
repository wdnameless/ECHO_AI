import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RulePreview } from "./RulePreview";

describe("RulePreview", () => {
  it("renders candidate text and action buttons in view mode", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    render(
      <RulePreview
        candidate="отвечай кратко и прямо"
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    expect(screen.getByRole("region", { name: "Превью правила" })).toBeInTheDocument();
    expect(screen.getByText("отвечай кратко и прямо")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Сохранить/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Править/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Отмена/i })).toBeInTheDocument();
  });

  it("calls onSave with candidate when Save is clicked in view mode", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    render(
      <RulePreview
        candidate="отвечай кратко и прямо"
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Сохранить/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("отвечай кратко и прямо");
  });

  it("calls onCancel when Cancel is clicked in view mode", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    render(
      <RulePreview
        candidate="отвечай кратко"
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Отмена/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("switches to edit mode, calls onEdit on input changes, and saves modified text", () => {
    const onSave = vi.fn();
    const onEdit = vi.fn();
    const onCancel = vi.fn();

    render(
      <RulePreview
        candidate="исходный вариант"
        onSave={onSave}
        onEdit={onEdit}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Править/i }));
    expect(onEdit).toHaveBeenCalledWith("исходный вариант");

    const input = screen.getByDisplayValue("исходный вариант");
    fireEvent.change(input, { target: { value: "отредактированный вариант" } });
    expect(onEdit).toHaveBeenCalledWith("отредактированный вариант");

    fireEvent.click(screen.getByRole("button", { name: /Сохранить/i }));
    expect(onSave).toHaveBeenCalledWith("отредактированный вариант");
  });

  it("saves on Enter key in edit mode", () => {
    const onSave = vi.fn();
    render(
      <RulePreview
        candidate="вариант для клавиш"
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Править/i }));
    const input = screen.getByDisplayValue("вариант для клавиш");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("вариант для клавиш");
  });

  it("cancels on Escape key in edit mode", () => {
    const onCancel = vi.fn();
    render(
      <RulePreview
        candidate="вариант для клавиш"
        onSave={vi.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Править/i }));
    const input = screen.getByDisplayValue("вариант для клавиш");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it("updates draft when candidate prop changes while not editing", () => {
    const { rerender } = render(
      <RulePreview
        candidate="первый кандидат"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText("первый кандидат")).toBeInTheDocument();

    rerender(
      <RulePreview
        candidate="уточнённый кандидат"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText("уточнённый кандидат")).toBeInTheDocument();
  });
});
