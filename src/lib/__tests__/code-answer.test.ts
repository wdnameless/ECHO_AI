import { describe, it, expect } from "vitest";
import {
  CODE_TEMPLATES,
  matchCodeTemplate,
} from "../code-templates";
import {
  buildCodePlan,
  buildCodeFull,
  buildCodeSystemPrompt,
} from "../code-answer";

/**
 * Live-coding mode: manual trigger, two stages, humanizer-free snippets.
 * A code answer that opens with "Слушайте, на прошлом проекте..." is a
 * failure — the candidate retypes this by hand under time pressure.
 */
describe("code templates", () => {
  it("covers the interview-frequent set (12+)", () => {
    expect(CODE_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    for (const t of CODE_TEMPLATES) {
      expect(t.snippet.trim().length).toBeGreaterThan(20);
      expect(t.narration.length).toBeGreaterThanOrEqual(2);
      expect(t.plan.trim().length).toBeGreaterThan(10);
    }
  });

  it("matches debounce by RU/EN keywords", () => {
    expect(matchCodeTemplate("напиши дебаунс для поиска")?.id).toBe("debounce");
    expect(matchCodeTemplate("implement debounce for input")?.id).toBe("debounce");
  });

  it("matches fetch/errors, memo, brackets, promises", () => {
    expect(matchCodeTemplate("fetch с обработкой ошибок")?.id).toBe("fetch-errors");
    expect(matchCodeTemplate("оптимизация через мемоизацию")?.id).toBe("memo-cache");
    expect(matchCodeTemplate("валидные скобки")?.id).toBe("valid-brackets");
    expect(matchCodeTemplate("Promise.all параллельно")?.id).toBe("promise-combinators");
  });

  it("returns null when nothing matches (plain code prompt)", () => {
    expect(matchCodeTemplate("расскажи про свой опыт")).toBeNull();
  });
});

describe("code answer stages", () => {
  it("stage 1 is a single plan phrase, no code", () => {
    const a = buildCodePlan("напиши дебаунс");
    expect(a.stage).toBe("plan");
    expect(a.text).not.toContain("```");
    expect(a.text.length).toBeLessThan(120);
  });

  it("stage 2 is snippet + narration, no humanizer openers", () => {
    const a = buildCodeFull("напиши дебаунс");
    expect(a.stage).toBe("full");
    expect(a.text).toContain("```");
    expect(a.text).not.toMatch(/Слушайте|на прошлом проекте|честно говоря/i);
  });

  it("unknown question yields empty full (caller streams the model)", () => {
    const a = buildCodeFull("расскажи про свой опыт");
    expect(a.text).toBe("");
    expect(a.template).toBeNull();
  });

  it("system prompt suppresses prose, injects reference on match", () => {
    const { prompt, template } = buildCodeSystemPrompt("напиши дебаунс");
    expect(template?.id).toBe("debounce");
    expect(prompt).toMatch(/REFERENCE SOLUTION/);
    expect(prompt).toMatch(/No conversational openers/);
  });

  it("system prompt is plain without a match", () => {
    const { prompt, template } = buildCodeSystemPrompt("расскажи про опыт");
    expect(template).toBeNull();
    expect(prompt).not.toMatch(/REFERENCE SOLUTION/);
  });
});
