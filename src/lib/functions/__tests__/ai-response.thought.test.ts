import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@/lib/storage/secret-store", () => ({
  getSecret: vi.fn(async (id: string) => `fixture-key-${id}`),
  secretKey: { aiProvider: (id: string) => id },
}));
vi.mock("@/lib", () => ({
  getResponseSettings: () => ({ language: "ru" }),
  LANGUAGES: [],
}));
vi.mock("../web-search", () => ({
  getWebSearchSettings: () => ({ enabled: false }),
}));
vi.mock("@/lib/rag", () => ({
  getRagContext: () => null,
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: vi.fn(),
}));

import {
  buildEnhancedSystemPrompt,
  THOUGHT_TRACE_PROMPT,
} from "../ai-response.function";
import { setAnswerMode } from "@/lib/answer-mode";
import { safeLocalStorage } from "@/lib/storage/helper";
import { LONG_LENGTH_PROMPT, SHORT_LENGTH_PROMPT } from "@/lib/answer-length";
import { HUMANIZER_INSTRUCTIONS } from "@/config/humanizer.rules";

describe("R01: Thought trace system prompt", () => {
  beforeEach(() => {
    safeLocalStorage.clear();
    setAnswerMode("interview");
  });

  it("does not include thought prompt in default interview mode", async () => {
    const prompt = await buildEnhancedSystemPrompt("Base prompt", "Что такое deadlock?");
    expect(prompt).not.toContain("THOUGHT-TRACE MODE");
    expect(prompt).toContain("Base prompt");
  });

  it("includes compact justification thought block after base prompt when mode is thought", async () => {
    setAnswerMode("thought");
    const prompt = await buildEnhancedSystemPrompt("Base prompt", "Что такое deadlock?");
    expect(prompt).toContain(THOUGHT_TRACE_PROMPT);
    expect(prompt.indexOf("Base prompt")).toBeLessThan(prompt.indexOf(THOUGHT_TRACE_PROMPT));
  });

  it("bypasses SHORT length cap in thought mode", async () => {
    // In interview mode with a short question, SHORT length cap is used
    setAnswerMode("interview");
    const interviewPrompt = await buildEnhancedSystemPrompt("", "Что это?");
    expect(interviewPrompt).toContain(SHORT_LENGTH_PROMPT);

    // In thought mode, SHORT length cap is bypassed and LONG prompt is used
    setAnswerMode("thought");
    const thoughtPrompt = await buildEnhancedSystemPrompt("", "Что это?");
    expect(thoughtPrompt).not.toContain(SHORT_LENGTH_PROMPT);
    expect(thoughtPrompt).toContain(LONG_LENGTH_PROMPT);
  });

  it("skips humanizer rules and rotating openers in thought mode", async () => {
    safeLocalStorage.setItem("humanizer_settings", JSON.stringify({ enabled: true, interviewMode: true }));

    setAnswerMode("interview");
    const interviewPrompt = await buildEnhancedSystemPrompt("", "Вопрос");
    expect(interviewPrompt).toContain(HUMANIZER_INSTRUCTIONS);
    expect(interviewPrompt).toMatch(/Open with exactly this phrase|Start straight into the answer/);

    setAnswerMode("thought");
    const thoughtPrompt = await buildEnhancedSystemPrompt("", "Вопрос");
    expect(thoughtPrompt).not.toContain(HUMANIZER_INSTRUCTIONS);
    expect(thoughtPrompt).not.toContain("Open with exactly this phrase");
  });

  it("does not duplicate thought block if baseSystemPrompt already contains it", async () => {
    setAnswerMode("thought");
    const baseWithThought = `Base prompt\n\n${THOUGHT_TRACE_PROMPT}`;
    const prompt = await buildEnhancedSystemPrompt(baseWithThought, "Вопрос");
    const occurrences = prompt.split("THOUGHT-TRACE MODE").length - 1;
    expect(occurrences).toBe(1);
  });
});
