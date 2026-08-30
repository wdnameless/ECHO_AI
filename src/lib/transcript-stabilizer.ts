/**
 * Transcript stabilization and spoken filler helpers.
 *
 * Requirements:
 * 1) Streaming transcripts must not flicker, jump, or disappear while speaking.
 * 2) My microphone transcript is displayed in UI as a speech row, but NEVER automatically sent to AI.
 * 3) An explicit "Ask AI" action allows manually sending my transcribed voice (or selected phrase) to AI.
 * 4) Organic Russian interview starter fillers are provided to bridge the 1-5 second inference delay.
 */

export type TranscriptSource = "me" | "them" | "ai";

export interface TranscriptUtterance {
  id: string;
  source: TranscriptSource;
  text: string;
  partial: boolean;
  timestamp: number;
  finalKey?: string;
  rawText?: string;
}

export interface UtteranceUpsertOptions {
  source: TranscriptSource;
  text: string;
  partial: boolean;
  timestamp?: number;
  currentActiveId?: string | null;
}

/**
 * Organic Russian conversational fillers to say during the 1-5s model delay.
 * Tone: natural, calm, professional interview style.
 */
export const RUSSIAN_INTERVIEW_FILLERS: readonly string[] = [
  "Слушайте, да, это отличный вопрос. Давайте разберём по порядку...",
  "Да, хороший вопрос, сейчас вспомню ключевые моменты на практике...",
  "Секундочку, структурирую ответ: здесь есть пара важных нюансов...",
  "Интересный кейс. Если смотреть с точки зрения архитектуры и опыта...",
  "Да, отличная тема, как раз недавно с этим сталкивался...",
  "Секундочку, давайте пройдёмся по основным шагам решения...",
  "Слушайте, вопрос как раз в точку. Начну с главного принципа...",
  "Да, момент действительно тонкий. Сейчас разложу по полочкам...",
];

/**
 * Returns a natural Russian filler preset based on seed or random index.
 */
export function selectRussianFiller(seedOrIndex?: number | string): string {
  if (typeof seedOrIndex === "number" && Number.isFinite(seedOrIndex)) {
    const idx = Math.abs(Math.floor(seedOrIndex)) % RUSSIAN_INTERVIEW_FILLERS.length;
    return RUSSIAN_INTERVIEW_FILLERS[idx];
  }
  if (typeof seedOrIndex === "string" && seedOrIndex.length > 0) {
    let hash = 0;
    for (let i = 0; i < seedOrIndex.length; i++) {
      hash = (hash * 31 + seedOrIndex.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % RUSSIAN_INTERVIEW_FILLERS.length;
    return RUSSIAN_INTERVIEW_FILLERS[idx];
  }
  const randomIdx = Math.floor(Math.random() * RUSSIAN_INTERVIEW_FILLERS.length);
  return RUSSIAN_INTERVIEW_FILLERS[randomIdx];
}

/**
 * Normalizes text for comparison and deduping.
 */
export function normalizeTranscriptText(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if a string is eligible for explicit manual "Ask AI" trigger.
 */
export function isExplicitAskEligible(text?: string | null): boolean {
  if (!text) return false;
  const cleaned = text.trim();
  return cleaned.length >= 3;
}

/**
 * Deterministic unique ID generator for utterances.
 */
export function generateUtteranceId(source: TranscriptSource, ts: number = Date.now()): string {
  return `${source}-${ts}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Stabilizes streaming utterances in a list so they do not flicker or jump.
 * While partial=true, updates the existing utterance in place monotonically.
 */
export function upsertUtterance(
  existingList: TranscriptUtterance[],
  options: UtteranceUpsertOptions
): { list: TranscriptUtterance[]; activeId: string } {
  const { source, text, partial, currentActiveId } = options;
  const trimmed = text.trim();
  if (!trimmed) {
    return { list: existingList, activeId: currentActiveId || "" };
  }

  const timestamp = options.timestamp ?? Date.now();
  const normalized = normalizeTranscriptText(trimmed);
  const nextList = [...existingList];

  // Try to find existing active row for this utterance
  let targetIndex = -1;
  if (currentActiveId) {
    targetIndex = nextList.findIndex((u) => u.id === currentActiveId);
  }

  // Fallback: look for the latest partial row of same source within last 12 seconds
  if (targetIndex === -1 && partial) {
    for (let i = nextList.length - 1; i >= 0; i--) {
      const item = nextList[i];
      if (item.source === source && item.partial && Math.abs(timestamp - item.timestamp) < 12_000) {
        targetIndex = i;
        break;
      }
    }
  }

  if (targetIndex >= 0) {
    const prev = nextList[targetIndex];
    // Monotonic text guard: if new partial is shorter than previous by accident (reconnect flutter),
    // keep the longer text unless it looks like a completely new sentence.
    let nextText = trimmed;
    if (partial && prev.partial && prev.text.length > trimmed.length + 5) {
      if (normalizeTranscriptText(prev.text).startsWith(normalized)) {
        nextText = prev.text;
      }
    }

    const updated: TranscriptUtterance = {
      ...prev,
      text: nextText,
      partial,
      rawText: trimmed,
      timestamp: Math.max(prev.timestamp, timestamp),
    };
    nextList[targetIndex] = updated;
    return { list: nextList, activeId: updated.id };
  }

  // Brand new utterance row
  const newId = generateUtteranceId(source, timestamp);
  const newUtterance: TranscriptUtterance = {
    id: newId,
    source,
    text: trimmed,
    partial,
    timestamp,
    rawText: trimmed,
  };

  nextList.push(newUtterance);
  return { list: nextList, activeId: newId };
}

/**
 * Finalizes an utterance when speech end/VAD boundary is reached.
 */
export function finalizeUtterance(
  existingList: TranscriptUtterance[],
  activeId: string,
  finalText?: string
): TranscriptUtterance[] {
  if (!activeId) return existingList;
  const index = existingList.findIndex((u) => u.id === activeId);
  if (index === -1) return existingList;

  const nextList = [...existingList];
  const target = nextList[index];
  const textToSet = (finalText && finalText.trim()) || target.text;

  nextList[index] = {
    ...target,
    text: textToSet,
    partial: false,
    finalKey: `${target.source}:${normalizeTranscriptText(textToSet).slice(0, 40)}`,
  };

  return nextList;
}
