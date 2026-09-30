import { safeLocalStorage } from "./storage/helper";
import type { AnswerLengthOverride } from "./answer-length";

const KEY = "answer_length_override";

/** Toolbar override for answer length. `auto` = heuristic decides. */
export function getAnswerLengthOverride(): AnswerLengthOverride {
  const stored = safeLocalStorage.getItem(KEY);
  return stored === "short" || stored === "long" ? stored : "auto";
}

export function setAnswerLengthOverride(v: AnswerLengthOverride): void {
  safeLocalStorage.setItem(KEY, v);
}
