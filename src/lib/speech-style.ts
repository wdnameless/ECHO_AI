import { ALL_DEFAULT_FILLERS } from "./filler-filter";
import { isStretchedFiller } from "./speech-filter";
import { safeLocalStorage } from "./storage/helper";

export const USER_SPEECH_LOG_STORAGE_KEY = "user_speech_transcripts";
const SELF_LEARNING_KEY = "self_learning_enabled";

export interface SpeechStyle {
  fillers: Array<{ word: string; count: number }>;
}

/**
 * Conversational discourse markers and personal speech fillers beyond bare hesitation sounds.
 * Includes Russian and English colloquial connectors commonly used in live interviews.
 */
export const CONVERSATIONAL_STYLE_FILLERS: readonly string[] = [
  "по факту",
  "смотрите",
  "слушайте",
  "собственно",
  "грубо говоря",
  "скажем так",
  "в целом",
  "в принципе",
  "честно говоря",
  "по сути",
  "знаете",
  "так сказать",
  "вообще",
  "короче говоря",
  "на самом деле",
  "угу",
  "ага",
  "мгм",
  "мхм",
  "ладно",
  "окей",
  "basically",
  "actually",
  "honestly",
  "literally",
  "sort of",
  "kind of",
  "right",
  "well",
];


const ALL_TRACKED_FILLERS: readonly string[] = Array.from(
  new Set([...ALL_DEFAULT_FILLERS, ...CONVERSATIONAL_STYLE_FILLERS])
);

const MULTI_WORD_FILLERS: readonly string[] = ALL_TRACKED_FILLERS.filter((f) =>
  f.includes(" ")
).sort((a, b) => b.length - a.length);

const SINGLE_WORD_FILLER_MAP: Record<string, true> = Object.fromEntries(
  ALL_TRACKED_FILLERS.filter((f) => !f.includes(" ")).map((f) => [
    f.toLowerCase(),
    true as const,
  ])
);

/**
 * Pure function: extracts the user's top-8 personal fillers and conversational
 * markers from raw speech transcripts (`ALL_DEFAULT_FILLERS`, conversational
 * markers like "по факту"/"смотрите", and stretched hesitation tokens).
 */
export function extractSpeechStyle(transcripts: string[]): SpeechStyle {
  if (!Array.isArray(transcripts) || transcripts.length === 0) {
    return { fillers: [] };
  }

  const counts = new Map<string, number>();
  const bump = (word: string, delta = 1) => {
    if (!word || delta <= 0) return;
    counts.set(word, (counts.get(word) ?? 0) + delta);
  };

  for (const raw of transcripts) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    let working = raw.toLowerCase().replace(/ё/g, "е");

    // 1. Extract multi-word filler phrases first and mask them out
    for (const phrase of MULTI_WORD_FILLERS) {
      const normalizedPhrase = phrase.toLowerCase().replace(/ё/g, "е");
      const escapedPhrase = normalizedPhrase.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );
      const pattern = new RegExp(
        `(?<=^|[\\s,.:;!?"'«»()—\\[\\]{}/<>])${escapedPhrase}(?=$|[\\s,.:;!?"'«»()—\\[\\]{}/<>])`,
        "giu"
      );
      const matches = working.match(pattern);
      if (matches && matches.length > 0) {
        bump(phrase.toLowerCase(), matches.length);
        working = working.replace(pattern, " ");
      }
    }

    // 2. Extract single-word fillers and stretched hesitation sounds
    const tokens = working.match(/[\p{L}]+(?:-[\p{L}]+)*/gu) ?? [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === "ну" && tokens[i + 1] === "же") {
        continue;
      }
      if (SINGLE_WORD_FILLER_MAP[token] || isStretchedFiller(token)) {
        bump(token, 1);
      }
    }
  }

  const fillers = Array.from(counts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return { fillers };
}

/**
 * Reads recorded raw user speech transcripts (`source="me"`) from storage.
 */
export function getUserSpeechTranscripts(): string[] {
  const raw = safeLocalStorage.getItem(USER_SPEECH_LOG_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Appends a raw user utterance (`source="me"`) to the speech style log
 * when self-learning is enabled.
 */
export function recordUserSpeech(rawText: string): void {
  const enabledRaw = safeLocalStorage.getItem(SELF_LEARNING_KEY);
  if (enabledRaw !== null && enabledRaw !== "true") {
    return;
  }
  const trimmed = (rawText || "").trim();
  if (!trimmed) return;

  const existing = getUserSpeechTranscripts();
  const next = [trimmed, ...existing].slice(0, 200);
  safeLocalStorage.setItem(USER_SPEECH_LOG_STORAGE_KEY, JSON.stringify(next));
}
