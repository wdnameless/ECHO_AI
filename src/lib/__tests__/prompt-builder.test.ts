import { describe, it, expect } from "vitest";
import {
  buildPrompt,
  buildPreviewPrompt,
  THOUGHT_TRACE_PROMPT,
  CONVERSATIONAL_FILTER_RULE,
} from "../prompt-builder";
import { MARKDOWN_FORMATTING_INSTRUCTIONS } from "@/config/constants";
import { SHORT_LENGTH_PROMPT, LONG_LENGTH_PROMPT } from "@/lib/answer-length";
import { VISUAL_PROMPT_HINT } from "@/lib/visual-answers";
import { LANGUAGE_RULE } from "@/lib/storage/user-facts";
import type { PromptProfile } from "@/lib/storage/prompt-profiles";

describe("prompt-builder", () => {
  it("builds prompt with base system prompt, conversational filter, and markdown rules", () => {
    const prompt = buildPrompt({
      baseSystemPrompt: "You are an expert software engineer.",
      answerLength: "short",
    });

    expect(prompt).toContain("You are an expert software engineer.");
    expect(prompt).toContain(CONVERSATIONAL_FILTER_RULE);
    expect(prompt).toContain(MARKDOWN_FORMATTING_INSTRUCTIONS);
    expect(prompt).toContain(SHORT_LENGTH_PROMPT);
    expect(prompt).toContain(LANGUAGE_RULE);
  });

  it("adds THOUGHT_TRACE_PROMPT and LONG_LENGTH_PROMPT in thought mode", () => {
    const prompt = buildPrompt({
      baseSystemPrompt: "Base prompt",
      mode: "thought",
      opener: "Well,",
      humanizer: { enabled: true, interviewMode: true },
    });

    expect(prompt).toContain(THOUGHT_TRACE_PROMPT);
    expect(prompt).toContain(LONG_LENGTH_PROMPT);
    // Thought mode skips opener and humanizer
    expect(prompt).not.toContain("Open with exactly this phrase");
    expect(prompt).not.toContain("HUMANIZER");
  });

  it("includes visual prompt hint when offerVisual is true", () => {
    const prompt = buildPrompt({
      baseSystemPrompt: "Base",
      offerVisual: true,
      answerLength: "long",
    });

    expect(prompt).toContain(VISUAL_PROMPT_HINT);
  });

  it("handles humanizer options correctly in non-thought mode", () => {
    const prompt = buildPrompt({
      baseSystemPrompt: "Base",
      answerLength: "short",
      humanizer: {
        enabled: true,
        interviewMode: true,
        customStyle: "Direct, punchy sentences.",
      },
    });

    expect(prompt).toContain("Match this personal speaking style: Direct, punchy sentences.");
    expect(prompt).toContain("LENGTH and OPENER are decided per-answer");
  });

  it("handles openers correctly", () => {
    const withOpener = buildPrompt({
      baseSystemPrompt: "Base",
      opener: "Indeed,",
    });
    expect(withOpener).toContain('Open with exactly this phrase, then answer: "Indeed,"');

    const withoutOpener = buildPrompt({
      baseSystemPrompt: "Base",
      opener: null,
    });
    expect(withoutOpener).toContain("Start straight into the answer with no introductory phrase.");
  });

  it("formats RAG contexts for resume, job, and past meetings", () => {
    const prompt = buildPrompt({
      baseSystemPrompt: "Base",
      resumeContent: "Senior Rust & TS Dev",
      jobContent: "Staff Backend Engineer",
      pastMeetingsContent: "Discussed architecture",
      evolutionBlock: "[EVOLUTION FACTS: style=concise]",
    });

    expect(prompt).toContain("[CONTEXT: MY RESUME]\nSenior Rust & TS Dev\n[/CONTEXT]");
    expect(prompt).toContain("[CONTEXT: JOB DESCRIPTION]\nStaff Backend Engineer\n[/CONTEXT]");
    expect(prompt).toContain("[CONTEXT: RELEVANT PAST MEETINGS]\nDiscussed architecture\n[/CONTEXT]");
    expect(prompt).toContain("[EVOLUTION FACTS: style=concise]");
  });

  it("buildPreviewPrompt returns matching prompt for PromptProfile", () => {
    const profile: PromptProfile = {
      id: "prof-1",
      name: "Tech Interview",
      description: "Test description",
      systemPrompt: "You are a tech lead candidate.",
      defaultLength: "short",
      humanizerEnabled: false,
      interviewMode: false,
      customStyle: "",
      ragResumeEnabled: false,
      ragJobEnabled: false,
    };

    const preview = buildPreviewPrompt(profile);
    expect(preview).toContain("You are a tech lead candidate.");
    expect(preview).toContain(CONVERSATIONAL_FILTER_RULE);
    expect(preview).toContain(MARKDOWN_FORMATTING_INSTRUCTIONS);
    expect(preview).toContain(SHORT_LENGTH_PROMPT);
  });
});
