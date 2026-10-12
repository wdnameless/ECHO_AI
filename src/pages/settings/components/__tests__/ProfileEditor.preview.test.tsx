import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileEditor, buildPreviewPrompt } from "../profiles/ProfileEditor";
import { RulesPanel } from "../profiles/RulesPanel";
import type { PromptProfile } from "@/lib/storage/prompt-profiles";
import {
  LANGUAGE_RULE,
  addUserFact,
  addUserRule,
  buildSelfEvolutionPromptBlock,
  setSelfLearningEnabled,
  resetLearning,
} from "@/lib/storage/user-facts";
import { MARKDOWN_FORMATTING_INSTRUCTIONS } from "@/config/constants";
import { SHORT_LENGTH_PROMPT, LONG_LENGTH_PROMPT } from "@/lib/answer-length";
import { HUMANIZER_INSTRUCTIONS } from "@/config/humanizer.rules";

const sampleProfile: PromptProfile = {
  id: "profile-interview",
  name: "Interview Mode",
  description: "Candidate answers",
  systemPrompt: "Base system prompt for candidate",
  humanizerEnabled: true,
  interviewMode: true,
  customStyle: "friendly and direct",
  ragResumeEnabled: true,
  ragJobEnabled: false,
  defaultLength: "short",
  isBuiltin: true,
};

describe("R10: ProfileEditor preview-parity with runtime prompt assembly", () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetLearning();
    setSelfLearningEnabled(true);
  });

  it("includes LANGUAGE_RULE and runtime builders in buildPreviewPrompt", () => {
    const preview = buildPreviewPrompt(sampleProfile);

    expect(preview).toContain("Base system prompt for candidate");
    expect(preview).toContain(MARKDOWN_FORMATTING_INSTRUCTIONS);
    expect(preview).toContain(SHORT_LENGTH_PROMPT);
    expect(preview).toContain(HUMANIZER_INSTRUCTIONS);
    expect(preview).toContain(LANGUAGE_RULE);
    expect(preview).not.toContain(
      "[LANGUAGE RULE]: Always answer in the language the question was asked"
    );

    const longPreview = buildPreviewPrompt({
      ...sampleProfile,
      defaultLength: "long",
    });
    expect(longPreview).toContain(LONG_LENGTH_PROMPT);
  });

  it("includes buildSelfEvolutionPromptBlock in preview when self-learning is enabled and omits when disabled", async () => {
    addUserFact("Senior Rust & Go backend engineer", "role");
    addUserRule("Отвечай коротко с примером из прода", { source: "manual" });

    const expectedEvolution = buildSelfEvolutionPromptBlock();
    expect(expectedEvolution).toContain("Senior Rust & Go backend engineer");
    expect(expectedEvolution).toContain("Отвечай коротко с примером из прода");

    const previewEnabled = buildPreviewPrompt(sampleProfile);
    expect(previewEnabled).toContain(LANGUAGE_RULE);
    expect(previewEnabled).toContain(expectedEvolution);

    render(
      <ProfileEditor
        profile={sampleProfile}
        isEditing={false}
        draft={null}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onSaveEdit={() => {}}
        onDraftChange={() => {}}
        onResetProfile={() => {}}
        onDeleteProfile={() => {}}
        onExportCurrent={() => {}}
        onExportAll={() => {}}
        onOpenImport={() => {}}
      />
    );

    const previewBtn = screen.getByRole("button", { name: /Превью промпта/i });
    await userEvent.click(previewBtn);

    const previewContainer = screen.getByTestId("profile-prompt-preview");
    expect(previewContainer.textContent).toContain("Senior Rust & Go backend engineer");
    expect(previewContainer.textContent).toContain("ЖЁСТКОЕ ПРАВИЛО ЯЗЫКА");

    setSelfLearningEnabled(false);
    const previewDisabled = buildPreviewPrompt(sampleProfile);
    expect(previewDisabled).toContain(LANGUAGE_RULE);
    expect(previewDisabled).not.toContain("Senior Rust & Go backend engineer");
    expect(previewDisabled).not.toContain("SELF-EVOLUTION ADAPTIVE PROFILE");
  });

  it("RulesPanel reads and mutates smart-rules store directly without drilled props", async () => {
    addUserRule("Всегда уточняй сложность по памяти", { source: "coach" });

    render(<RulesPanel />);

    expect(screen.getByTestId("rules-panel")).toBeInTheDocument();
    expect(screen.getByText("Всегда уточняй сложность по памяти")).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/Add custom rule/i);
    await userEvent.type(input, "Приводи пример из Go");
    const addBtn = screen.getByRole("button", { name: "Add" });
    await userEvent.click(addBtn);

    expect(screen.getByText("Приводи пример из Go")).toBeInTheDocument();
  });
});
