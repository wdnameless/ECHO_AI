import { safeLocalStorage } from "./storage/helper";

export type AnswerMode = "interview" | "thought" | "livecode";

const KEY = "answer_mode";

/** Current answer mode: interview (default), thought (justification trace), or livecode (coding frame). */
export function getAnswerMode(): AnswerMode {
  const stored = safeLocalStorage.getItem(KEY);
  return stored === "thought" || stored === "livecode" ? stored : "interview";
}

export function setAnswerMode(v: AnswerMode): void {
  safeLocalStorage.setItem(KEY, v);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("answer-mode-changed", { detail: v }));
  }
}
