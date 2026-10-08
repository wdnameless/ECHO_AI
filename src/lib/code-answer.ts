/**
 * Live-coding answer mode: two stages, both hand-typable.
 *
 * R01/R02: the mode is entered ONLY by an explicit trigger (button/hotkey) —
 * never by auto-detect. Stage 1 answers immediately with a 1-phrase plan.
 * Stage 2 (explicit "show code") streams the snippet + 2-3 narration lines.
 *
 * The code path bypasses the humanizer: conversational openers
 * ("Слушайте, на прошлом проекте...") inside a copied snippet are a failure,
 * not a feature. Indentation must survive verbatim.
 */

import { matchCodeTemplate, type CodeTemplate } from "./code-templates";
import { formatSpokenAnswer } from "./spoken-format";
export type CodeStage = "plan" | "full";

/** What the UI renders for a code answer. */
export interface CodeAnswer {
  stage: CodeStage;
  /** Stage 1: one phrase. Stage 2: snippet + narration joined for streaming. */
  text: string;
  template: CodeTemplate | null;
  copyText?: string;
  /** Language tag for the fence (ts, sql, …). */
  lang?: string;
}
const CODE_SYSTEM_PROMPT = [
  "You are a live-coding assistant on a job interview. The interviewer dictates a coding task by voice (without IDE or screen access). The candidate retypes",
  "your answer by hand into an editor while speaking aloud.",
  "Rules:",
  "- Output a single fenced code block with the solution, then a BLANK LINE,",
  "  then narration lines the candidate says while typing (plain text, no bullets).",
  "  The blank line is required: without it the block does not render and the code collapses into one prose line.",
  "- Narration MUST include:",
  "  1. 1-2 concise lines explaining the algorithm and key logic.",
  "  2. Big-O time and space complexity explicitly stated (e.g. 'Сложность: O(n) по времени, O(1) по памяти' / 'Time: O(n), Space: O(1)').",
  "  3. 1-2 key edge cases or test cases to verify (e.g. empty input, boundaries, error cases).",
  "- Indent code with TABS (not spaces): the candidate retypes with tab stops.",
  "- No conversational openers, no stories, no markdown headings, no bullet lists.",
  "- Code must be complete, runnable, and free of placeholder comments.",
  "- Prefer TypeScript + React idioms; keep it short enough to retype in 2-3 minutes.",
  "- Answer in the same language the question was asked in (code comments match).",
].join(" ");

const CODE_PLAN_SYSTEM_PROMPT = [
  "You are a live-coding assistant on a job interview. The interviewer dictates a coding task by voice.",
  "Rules:",
  "- Output ONLY a concise 1-2 sentence high-level plan or algorithm approach (NO code blocks, no backticks, no markdown headings, no bullet lists).",
  "- Keep it under 120 characters, suitable to speak aloud immediately before typing.",
  "- No conversational openers, no stories.",
  "- Answer in the same language the question was asked in.",
].join(" ");

/**
 * Builds the system prompt for a code answer. When a template matches, its
 * snippet is injected as the reference solution so the model adapts it instead
 * of inventing from scratch; otherwise the model works from the plain prompt.
 */
export function buildCodeSystemPrompt(question: string, withScreenshot = false): {
  prompt: string;
  template: CodeTemplate | null;
} {
  const template = matchCodeTemplate(question);
  const visionRule = withScreenshot
    ? " The screenshot shows the code under discussion: read it (OCR), then answer: 1-2 phrases of what is wrong, then the fixed fenced block with TABS, then 2-3 narration lines."
    : "";
  const base = CODE_SYSTEM_PROMPT + visionRule;
  if (!template) return { prompt: base, template: null };
  return {
    prompt: `${base}\n\n[REFERENCE SOLUTION — adapt, do not paste blindly]\n${template.snippet}`,
    template,
  };
}
/**
 * Builds the system prompt for stage 1 plan fallback when no static template matches.
 * Prompts the model to generate a concise 1-2 sentence high-level approach.
 */
export function buildCodePlanSystemPrompt(question: string): {
  prompt: string;
  template: CodeTemplate | null;
} {
  const template = matchCodeTemplate(question);
  if (!template) return { prompt: CODE_PLAN_SYSTEM_PROMPT, template: null };
  return {
    prompt: `${CODE_PLAN_SYSTEM_PROMPT}\n\n[REFERENCE PLAN]\n${template.plan}`,
    template,
  };
}


/** Stage 1: immediate plan phrase. Template plan or a generic fallback. */
export function buildCodePlan(question: string): CodeAnswer {
  const template = matchCodeTemplate(question);
  if (!template) {
    return { stage: "plan", text: "", template: null };
  }
  return {
    stage: "plan",
    text: template.plan,
    template,
  };
}

/**
 * Stage 2: full answer. Template snippet + narration when matched (no model
 * call needed — instant and deterministic); otherwise the caller streams the
 * model with `buildCodeSystemPrompt(question).prompt`.
 */
interface TemplateComplexity {
  bigO: string;
  testCases: string;
}

const TEMPLATE_COMPLEXITY: Record<string, TemplateComplexity> = {
  debounce: {
    bigO: "Сложность: O(1) по времени, O(1) по памяти.",
    testCases: "Тест-кейсы: частые вызовы до 300мс откладывают выполнение, unmount очищает таймер.",
  },
  throttle: {
    bigO: "Сложность: O(1) по времени, O(1) по памяти.",
    testCases: "Тест-кейсы: частые события пропускаются, вызов выполняется не чаще раз в лимит.",
  },
  "fetch-errors": {
    bigO: "Сложность: O(1) по памяти (без учета payload), время O(network).",
    testCases: "Тест-кейсы: ошибка 404/500 сохраняет сообщение, размонтирование отменяет запрос через AbortController.",
  },
  "list-search": {
    bigO: "Сложность: O(n log n) по времени из-за сортировки, O(n) по памяти.",
    testCases: "Тест-кейсы: пустой запрос query возвращает весь отсортированный список, совпадения без учета регистра.",
  },
  "memo-cache": {
    bigO: "Сложность: O(n) по времени для подсчета суммы, O(1) по памяти.",
    testCases: "Тест-кейсы: пустой список items дает 0, изменение qty пересчитывает total.",
  },
  "group-by": {
    bigO: "Сложность: O(n) по времени, O(n) по памяти.",
    testCases: "Тест-кейсы: пустой массив возвращает {}, элементы с одинаковым ключом собираются в один массив.",
  },
  "valid-brackets": {
    bigO: "Сложность: O(n) по времени, O(n) по памяти для стека.",
    testCases: "Тест-кейсы: '()' -> true, '([)]' -> false, '(((' -> false, пустая строка -> true.",
  },
  "promise-combinators": {
    bigO: "Сложность: O(max(t_i)) для Promise.all, O(min(t_i)) для Promise.race.",
    testCases: "Тест-кейсы: отказ одного промиса реджектит all, таймаут в race отклоняет долгий fetch.",
  },
  "refactor-module": {
    bigO: "Сложность: O(n) по времени для фильтрации, O(n) по памяти.",
    testCases: "Тест-кейсы: пустой список рендерит пустой ul, изменение query фильтрует без сброса DOM-состояния.",
  },
  "shallow-equal": {
    bigO: "Сложность: O(k) по времени (k — число ключей), O(k) по памяти.",
    testCases: "Тест-кейсы: одинаковые ссылки -> true, разное число ключей -> false, одинаковые примитивные поля -> true.",
  },
  emitter: {
    bigO: "Сложность: O(1) подписка и отписка в Set, O(k) emit для k подписчиков.",
    testCases: "Тест-кейсы: отписка через возвращенную функцию удаляет слушатель, emit передает аргументы всем слушателям.",
  },
  "lru-cache": {
    bigO: "Сложность: O(1) для get и set за счет порядка ключей в Map.",
    testCases: "Тест-кейсы: превышение limit удаляет старый ключ, повторный get освежает порядок.",
  },
};

export function enrichNarration(template: CodeTemplate): string[] {
  const narration = [...template.narration];
  const meta = TEMPLATE_COMPLEXITY[template.id];
  if (meta) {
    if (!narration.some((line) => /O\(|сложност|complexity|big-o/i.test(line))) {
      narration.push(meta.bigO);
    }
    if (!narration.some((line) => /тест|test|edge case/i.test(line))) {
      narration.push(meta.testCases);
    }
  }
  return narration;
}

export function buildCodeFull(question: string): CodeAnswer {
  const template = matchCodeTemplate(question);
  if (!template) {
    return { stage: "full", text: "", template: null };
  }
  // Fence + blank line + narration: streamdown needs the blank line to open
  // a real code block; without it the snippet renders as inline prose (that
  // was the "одна строка" bug). copyText carries tabs verbatim for retyping.
  const narration = enrichNarration(template);
  return {
    stage: "full",
    text: ["```ts", template.snippet, "```", "", ...narration].join("\n"),
    template,
    copyText: template.snippet,
    lang: "ts",
  };
}

export interface SplitCodeResult {
  code: string | null;
  lang: string;
  prose: string[];
}

/**
 * Splits a code answer into fence block + spoken prose.
 * Tolerates unclosed fences during streaming so the code block renders unbroken.
 */
export function splitCodeAnswer(text: string): SplitCodeResult {
  if (!text) return { code: null, lang: "", prose: [] };

  // 1. Closed code block: ```lang\ncode``` (supports 3+ backticks or 3+ tildes, lang with special chars like c++, c#)
  const closedMatch = text.match(/(?:^|\r?\n)[ \t]*(`{3,}|~{3,})([^\r\n]*)\r?\n([\s\S]*?)\r?\n?[ \t]*\1[ \t]*(?:\r?\n|$)/)
    || text.match(/(`{3,}|~{3,})([^\r\n]*)\r?\n([\s\S]*?)\1/);
  if (closedMatch && closedMatch.index !== undefined) {
    const rawLang = closedMatch[2];
    const code = closedMatch[3] ?? "";
    const lang = rawLang.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9_+#.-]/g, "") || "ts";

    const matchStart = closedMatch.index;
    const matchEnd = matchStart + closedMatch[0].length;
    const before = text.slice(0, matchStart).trim();
    const after = text.slice(matchEnd).trim();
    const rest = [before, after].filter(Boolean).join("\n\n");

    return {
      code: code.replace(/\r?\n$/, ""),
      lang,
      prose: formatSpokenAnswer(rest),
    };
  }
  const unclosedMatch = text.match(/(?:^|\r?\n)[ \t]*(`{3,}|~{3,})([^\r\n]*)(?:\r?\n([\s\S]*))?$/);
  if (unclosedMatch && unclosedMatch.index !== undefined) {
    const rawLang = unclosedMatch[2];
    let code = unclosedMatch[3];
    const lang = rawLang.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9_+#.-]/g, "") || "ts";
    const fenceStart = text.indexOf(unclosedMatch[1], unclosedMatch.index);
    const before = text.slice(0, fenceStart).trim();

    if (code !== undefined) {
      // Tolerate partial closing fence being streamed at the end (e.g. \n` or \n``)
      code = code.replace(/\r?\n`{1,2}$/, "");

      // Tolerant fallback: if the model forgot closing fence and emitted narration after a blank line
      const narrationSplit = code.match(/(\r?\n\s*\r?\n)(?=(?:Big-O|Complexity|Time complexity|Сложность|Тест-кейсы|Test cases|Edge cases)[:\s]|(?:[А-ЯЁ][а-яё]+(?: [а-яё]+){2,}))/i);
      if (narrationSplit && narrationSplit.index !== undefined) {
        const codePart = code.slice(0, narrationSplit.index).replace(/\r?\n$/, "");
        const trailingProse = code.slice(narrationSplit.index + narrationSplit[1].length).trim();
        const combined = [before, trailingProse].filter(Boolean).join("\n\n");
        return {
          code: codePart,
          lang,
          prose: formatSpokenAnswer(combined),
        };
      }

      return {
        code: code.replace(/\r?\n$/, ""),
        lang,
        prose: formatSpokenAnswer(before),
      };
    }

    return {
      code: "",
      lang,
      prose: formatSpokenAnswer(before),
    };
  }

  // 3. No code block found — plain spoken prose
  return {
    code: null,
    lang: "",
    prose: formatSpokenAnswer(text),
  };
}

export function splitCodeForCopy(text: string): string {
  const { code } = splitCodeAnswer(text);
  return code ?? text;
}
