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
  "You are a live-coding assistant on a job interview. The candidate retypes",
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

/** Stage 1: immediate plan phrase. Template plan or a generic fallback. */
export function buildCodePlan(question: string): CodeAnswer {
  const template = matchCodeTemplate(question);
  return {
    stage: "plan",
    text: template?.plan ?? "Пишем аккуратно по шагам: сначала каркас, потом детали.",
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
