import { describe, it, expect } from "vitest";
import {
  CODE_TEMPLATES,
  matchCodeTemplate,
  findCodeRequestInHistory,
} from "../code-templates";
import {
  buildCodePlan,
  buildCodePlanSystemPrompt,
  buildCodeFull,
  buildCodeSystemPrompt,
  splitCodeAnswer,
  splitCodeForCopy,
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
  it("unknown question yields empty plan (caller streams model with plan prompt)", () => {
    const a = buildCodePlan("напиши алгоритм дейкстры на графе");
    expect(a.stage).toBe("plan");
    expect(a.text).toBe("");
    expect(a.template).toBeNull();
  });

  it("plan fallback prompt instructs model for 1-2 sentence high-level approach", () => {
    const { prompt, template } = buildCodePlanSystemPrompt("напиши алгоритм дейкстры на графе");
    expect(template).toBeNull();
    expect(prompt).toMatch(/1-2 sentence/i);
    expect(prompt).toMatch(/NO code blocks/i);
    expect(prompt).toMatch(/voice/i);
  });

  it("plan prompt injects reference plan when template matches", () => {
    const { prompt, template } = buildCodePlanSystemPrompt("напиши дебаунс");
    expect(template?.id).toBe("debounce");
    expect(prompt).toMatch(/REFERENCE PLAN/);
    expect(prompt).toContain(template!.plan);
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

  it("system prompt includes voice-dictation framing without screen/IDE access", () => {
    const { prompt } = buildCodeSystemPrompt("любая задача");
    expect(prompt).toMatch(/interviewer dictates a coding task by voice/i);
    expect(prompt).toMatch(/without IDE or screen access/i);
  });
});

describe("findCodeRequestInHistory", () => {
  it("finds the code task buried under later chatter", () => {
    const hist = [
      "That create transact so. GLM select switch to which is",
      "Пишем аккуратно по шагам: сначала каркас, потом детали.",
      "Mm-hmm.",
      "Да, давайте так. Мы просто открываем транзакцию...",
      "Напиши функцию, пусть будет на псевдопитон с понятными шагами, минималистично.",
      "Да, понятная задача. Мы обычно вешаем уникальный индекс...",
      "BAAAAA Логично. Но помни. Это привет. Давай, марий.",
      "Если в двух словах я бы завязался на уникальный constraint...",
    ];
    expect(findCodeRequestInHistory(hist)).toContain("Напиши функцию");
  });

  it("prefers the NEWEST code request when several exist", () => {
    const hist = [
      "напиши дебаунс для поиска",
      "ок, понял",
      "а теперь напиши функцию валидации скобок",
      "ага",
    ];
    expect(findCodeRequestInHistory(hist)).toContain("скобок");
  });

  it("returns null when nobody asked for code", () => {
    expect(findCodeRequestInHistory(["Mm-hmm.", "Логично.", "Да, понятно."])).toBeNull();
  });
});


describe("buildCodeSystemPrompt with screenshot", () => {
  it("adds the vision rule when a screenshot rides along", () => {
    const { prompt } = buildCodeSystemPrompt("почини", true);
    expect(prompt).toMatch(/screenshot/i);
    expect(prompt).toMatch(/TABS/);
  });

  it("no vision rule without screenshot", () => {
    const { prompt } = buildCodeSystemPrompt("почини", false);
    expect(prompt).not.toMatch(/screenshot/i);
  });
});

describe("splitCodeAnswer stream tolerance (R02)", () => {
  it("splits closed code block and spoken narration", () => {
    const text = "```ts\nfunction debounce() {}\n```\nТаймер сбрасывается при каждом вызове.";
    const split = splitCodeAnswer(text);
    expect(split.code).toBe("function debounce() {}");
    expect(split.lang).toBe("ts");
    expect(split.prose).toEqual(["Таймер сбрасывается при каждом вызове."]);
  });

  it("tolerates unclosed fence during streaming without breaking", () => {
    const partial = "```ts\nfunction debounce(fn, ms) {\n  let timer;";
    const split = splitCodeAnswer(partial);
    expect(split.code).toBe("function debounce(fn, ms) {\n  let timer;");
    expect(split.lang).toBe("ts");
    expect(split.prose).toEqual([]);
  });

  it("tolerates unclosed fence with preceding introductory text", () => {
    const partial = "Вот решение:\n```python\ndef solve():\n    return 42";
    const split = splitCodeAnswer(partial);
    expect(split.code).toBe("def solve():\n    return 42");
    expect(split.lang).toBe("python");
    expect(split.prose).toEqual(["Вот решение:"]);
  });

  it("tolerates just-opened fence (backticks only)", () => {
    const split = splitCodeAnswer("```");
    expect(split.code).toBe("");
    expect(split.lang).toBe("ts");
    expect(split.prose).toEqual([]);
  });

  it("returns null code for regular prose without backticks", () => {
    const split = splitCodeAnswer("Рассказываю про свой опыт работы на проекте.");
    expect(split.code).toBeNull();
    expect(split.lang).toBe("");
    expect(split.prose).toEqual(["Рассказываю про свой опыт работы на проекте."]);
  });

  it("splitCodeForCopy extracts snippet even during unclosed streaming", () => {
    const partial = "```ts\nconst x = 123;";
    expect(splitCodeForCopy(partial)).toBe("const x = 123;");
  });
});
