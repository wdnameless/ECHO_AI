import { describe, it, expect } from "vitest";
import {
  buildPrompt,
  buildPreviewPrompt,
  THOUGHT_TRACE_PROMPT,
  CONVERSATIONAL_FILTER_RULE,
  PROMPT_BLOCK_ORDER,
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

  it("enforces locked block order with statics first and volatiles at tail", () => {
    expect(PROMPT_BLOCK_ORDER).toEqual([
      "base",
      "thought",
      "filter",
      "visual",
      "length",
      "humanizer",
      "opener",
      "resume",
      "job",
      "memory",
      "language",
      "evolution",
      "search",
    ]);

    const prompt = buildPrompt({
      baseSystemPrompt: "BASE_BLOCK",
      mode: "thought",
      offerVisual: true,
      humanizer: { enabled: true, interviewMode: true, customStyle: "PUNCHY" },
      opener: "OPENER_PHRASE",
      resumeContent: "RESUME_INFO",
      jobContent: "JOB_INFO",
      pastMeetingsContent: "MEETING_INFO",
      languagePrompt: "LANGUAGE_PROMPT_BLOCK",
      evolutionBlock: "EVOLUTION_BLOCK",
      searchBlock: "SEARCH_BLOCK",
    });

    const baseIdx = prompt.indexOf("BASE_BLOCK");
    const thoughtIdx = prompt.indexOf(THOUGHT_TRACE_PROMPT);
    const filterIdx = prompt.indexOf(CONVERSATIONAL_FILTER_RULE);
    const visualIdx = prompt.indexOf(VISUAL_PROMPT_HINT);
    const lengthIdx = prompt.indexOf(LONG_LENGTH_PROMPT);
    const resumeIdx = prompt.indexOf("[CONTEXT: MY RESUME]");
    const jobIdx = prompt.indexOf("[CONTEXT: JOB DESCRIPTION]");
    const memoryIdx = prompt.indexOf("[CONTEXT: RELEVANT PAST MEETINGS]");
    const langIdx = prompt.indexOf("LANGUAGE_PROMPT_BLOCK");
    const evoIdx = prompt.indexOf("EVOLUTION_BLOCK");
    const searchIdx = prompt.indexOf("SEARCH_BLOCK");

    expect(baseIdx).toBeLessThan(thoughtIdx);
    expect(thoughtIdx).toBeLessThan(filterIdx);
    expect(filterIdx).toBeLessThan(visualIdx);
    expect(visualIdx).toBeLessThan(lengthIdx);
    expect(lengthIdx).toBeLessThan(resumeIdx);
    expect(resumeIdx).toBeLessThan(jobIdx);
    expect(jobIdx).toBeLessThan(memoryIdx);
    expect(memoryIdx).toBeLessThan(langIdx);
    expect(langIdx).toBeLessThan(evoIdx);
    expect(evoIdx).toBeLessThan(searchIdx);
  });

  it("guarantees byte-level prefix stability across volatile changes (R01)", () => {
    const staticCtx = {
      baseSystemPrompt: "You are a senior software architect.",
      userMessage: "Explain the Raft consensus algorithm.",
      offerVisual: true,
      answerLength: "long" as const,
      resumeContent: "10 years backend experience",
      jobContent: "Lead Distributed Systems Engineer",
      pastMeetingsContent: "Discussed consensus trade-offs",
    };

    const promptRu = buildPrompt({
      ...staticCtx,
      languagePrompt: "Answer strictly in Russian.",
      evolutionBlock: "User prefers Russian technical terms.",
      searchBlock: "Search result: Raft paper 2014",
    });

    const promptEn = buildPrompt({
      ...staticCtx,
      languagePrompt: "Answer strictly in English.",
      evolutionBlock: "User prefers concise bullet points.",
      searchBlock: "Search result: Paxos vs Raft comparison",
    });

    const volatileStartRu = promptRu.indexOf("Answer strictly in Russian.");
    const volatileStartEn = promptEn.indexOf("Answer strictly in English.");
    expect(volatileStartRu).toBe(volatileStartEn);
    expect(volatileStartRu).toBeGreaterThan(0);

    const prefixRu = promptRu.slice(0, volatileStartRu);
    const prefixEn = promptEn.slice(0, volatileStartEn);
    expect(prefixRu).toBe(prefixEn);

    const promptEvo1 = buildPrompt({
      ...staticCtx,
      languagePrompt: "Answer strictly in Russian.",
      evolutionBlock: "Evolution variant A",
    });
    const promptEvo2 = buildPrompt({
      ...staticCtx,
      languagePrompt: "Answer strictly in Russian.",
      evolutionBlock: "Evolution variant B",
    });
    const evoStart1 = promptEvo1.indexOf("Evolution variant A");
    const evoStart2 = promptEvo2.indexOf("Evolution variant B");
    expect(evoStart1).toBe(evoStart2);
    expect(promptEvo1.slice(0, evoStart1)).toBe(promptEvo2.slice(0, evoStart2));
  });
});
