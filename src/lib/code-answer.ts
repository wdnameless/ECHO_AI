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
  "  then 2-3 SHORT lines of narration the candidate says while typing",
  "  (plain text, no bullets). The blank line is required: without it the",
  "  block does not render and the code collapses into one prose line.",
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
export function buildCodeFull(question: string): CodeAnswer {
  const template = matchCodeTemplate(question);
  if (!template) {
    return { stage: "full", text: "", template: null };
  }
  // Fence + blank line + narration: streamdown needs the blank line to open
  // a real code block; without it the snippet renders as inline prose (that
  // was the "одна строка" bug). copyText carries tabs verbatim for retyping.
  return {
    stage: "full",
    text: ["```ts", template.snippet, "```", "", ...template.narration].join("\n"),
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

  // 1. Closed code block: ```lang\ncode```
  const closedMatch = text.match(/```(\w*)\r?\n([\s\S]*?)```/);
  if (closedMatch) {
    const [, lang, code] = closedMatch;
    const rest = (
      text.slice(0, closedMatch.index) +
      text.slice(closedMatch.index! + closedMatch[0].length)
    ).trim();
    return {
      code: code.replace(/\r?\n$/, ""),
      lang: lang || "ts",
      prose: formatSpokenAnswer(rest),
    };
  }

  // 2. Unclosed code block during streaming: ```lang\ncode... or ```lang
  const unclosedMatch = text.match(/```(\w*)(?:\r?\n([\s\S]*))?$/);
  if (unclosedMatch) {
    const [, lang, code] = unclosedMatch;
    const rest = text.slice(0, unclosedMatch.index).trim();
    return {
      code: code !== undefined ? code.replace(/\r?\n$/, "") : "",
      lang: lang || "ts",
      prose: formatSpokenAnswer(rest),
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
