/**
 * Answer length: heuristic auto + manual override.
 *
 * Why this file: INTERVIEW_MODE_INSTRUCTIONS hard-caps every answer at 35-55
 * words. A "почему" with architecture details cannot fit — and the model obeyed
 * the cap instead of the question. Length is now decided per question:
 * explicit prefix > toolbar override > heuristic.
 */

/** Manual override from the toolbar. `auto` = let the heuristic decide. */
export type AnswerLengthOverride = "auto" | "short" | "long";

const LONG_PREFIXES = ["подробно:", "подробно :", "long:", "детально:", "развернуто:"];
const SHORT_PREFIXES = ["кратко:", "кратко :", "short:", "вкратце:", "тезисно:"];

/** Markers that request detail even without a question mark. */
const DETAIL_MARKERS = [
  "почему",
  "зачем",
  "сколько",
  "сравни",
  "разница",
  "отличие",
  "подробно",
  "пошагово",
  "по шагам",
  "детально",
  "развернуто",
  "объясни",
  "расскажи",
  "why",
  "how much",
  "how many",
  "compare",
  "difference",
  "explain in detail",
  "step by step",
  "walk me through",
];

/**
 * Splits an explicit length prefix off the question.
 * Returns the override + the cleaned question (prefix removed).
 */
export function splitLengthPrefix(question: string): {
  override: AnswerLengthOverride;
  cleaned: string;
} {
  const q = question.trim();
  const lower = q.toLowerCase();
  for (const p of LONG_PREFIXES) {
    if (lower.startsWith(p)) {
      return { override: "long", cleaned: q.slice(p.length).trim() };
    }
  }
  for (const p of SHORT_PREFIXES) {
    if (lower.startsWith(p)) {
      return { override: "short", cleaned: q.slice(p.length).trim() };
    }
  }
  return { override: "auto", cleaned: q };
}

export function isLongQuestion(question: string): boolean {
  const q = question.trim().toLowerCase();
  if (q.length > 140) return true;
  if (q.includes("?") && q.length > 60) return true;
  return DETAIL_MARKERS.some((m) => q.includes(m));
}

/** Final decision: explicit prefix > toolbar override > heuristic. */
export function resolveAnswerLength(
  question: string,
  toolbar: AnswerLengthOverride
): "short" | "long" {
  const { override } = splitLengthPrefix(question);
  if (override !== "auto") return override;
  if (toolbar !== "auto") return toolbar;
  return isLongQuestion(question) ? "long" : "short";
}

export const SHORT_LENGTH_PROMPT =
  "Keep it tight: 1-3 spoken sentences (35-55 words maximum). One thought + one concrete number or example. No lists, no headings.";

export const LONG_LENGTH_PROMPT =
  "Answer in full: up to ~140 words of connected spoken monologue. Cover the what, the why, and one concrete example with numbers. Still no bullet points, no headings, no markdown lists — this is spoken aloud, not read from a doc.";
