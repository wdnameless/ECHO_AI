/**
 * Speech filter utilities to distinguish between conversational fillers/backchannels
 * (e.g., "угу", "мгм", "ага", "yeah", "uh-huh") and actual questions or substantive queries.
 */

const FILLER_PATTERNS = new Set([
  // Russian fillers and backchannels
  "угу",
  "мгм",
  "мхм",
  "ага",
  "да",
  "ну",
  "хм",
  "гм",
  "мм",
  "эм",
  "э-э",
  "э",
  "а",
  "о",
  "ох",
  "ой",
  "понятно",
  "ок",
  "ясно",
  "ладно",
  "так",
  "слушаю",
  "да-да",
  "ага-ага",
  "агась",
  "угум",
  "давай",
  "хорошо",
  "точно",
  "круто",
  "ого",
  "ну да",
  "да уж",
  "ага да",
  "угу да",
  "понял",
  "поняла",
  "слышу",
  "плюс",
  "ага понятно",
  "угу понятно",
  "да понятно",
  "да хорошо",
  "ну ладно",
  "ну ок",
  "окей",

  // English fillers and backchannels
  "uh-huh",
  "uh huh",
  "mhm",
  "mm-hmm",
  "mm hmm",
  "yeah",
  "yep",
  "yup",
  "yea",
  "ok",
  "okay",
  "right",
  "got it",
  "sure",
  "ah",
  "oh",
  "um",
  "uh",
  "huh",
  "cool",
  "alright",
  "all right",
  "i see",
  "yes",
  "yeah yeah",
  "yes yes",
  "no problem",
  "sounds good",
  "nice",
  "fine",
  "yep yep",
  "gotcha",
  "understood",
  "indeed",
  "true",
]);

const QUESTION_STARTERS_RU = [
  "кто",
  "что",
  "где",
  "когда",
  "почему",
  "зачем",
  "как",
  "сколько",
  "какой",
  "какая",
  "какое",
  "какие",
  "каким",
  "какому",
  "чем",
  "кому",
  "кого",
  "куда",
  "откуда",
  "расскажи",
  "расскажите",
  "объясни",
  "объясните",
  "подскажи",
  "подскажите",
  "опиши",
  "назови",
  "сравни",
  "напиши",
  "покажи",
  "можешь",
  "можете",
  "есть ли",
  "бывает ли",
  "правда ли",
  "в чем",
  "в чём",
];

const QUESTION_STARTERS_EN = [
  "what",
  "how",
  "why",
  "where",
  "when",
  "who",
  "whom",
  "which",
  "whose",
  "can you",
  "could you",
  "would you",
  "will you",
  "tell me",
  "explain",
  "describe",
  "compare",
  "is it",
  "is there",
  "are there",
  "are you",
  "do you",
  "does it",
  "did you",
  "have you",
  "has it",
  "should I",
  "how do",
  "what is",
  "what are",
];

/**
 * Normalizes text for filler checking by stripping punctuation and lowercasing.
 */
export function normalizeUtterance(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}"'«»—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true if the utterance is purely a conversational filler or backchannel noise.
 */
export function isFillerOrBackchannel(text: string): boolean {
  if (!text) return true;
  const normalized = normalizeUtterance(text);
  if (!normalized || normalized.length <= 1) return true;

  // Direct match in filler set
  if (FILLER_PATTERNS.has(normalized)) return true;

  // Check if utterance is just 1 or 2 repeated filler words (e.g. "угу угу", "да да")
  const words = normalized.split(" ").filter(Boolean);
  if (words.length <= 3) {
    const allFillers = words.every((w) => FILLER_PATTERNS.has(w) || w.length <= 2);
    if (allFillers) return true;
  }

  return false;
}

/**
 * Determines whether a transcribed utterance should trigger an automated AI response.
 * Filters out fillers, backchannels, and short acknowledgments.
 */
export function shouldTriggerAIResponse(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;

  // If it's a known filler or backchannel, do not trigger AI
  if (isFillerOrBackchannel(trimmed)) {
    return false;
  }

  // Explicit question mark is always a trigger
  if (trimmed.includes("?")) {
    return true;
  }

  const normalized = normalizeUtterance(trimmed);
  const words = normalized.split(" ").filter(Boolean);

  // If very short (1-2 words) without question mark, skip unless it's a question starter
  if (words.length <= 2) {
    const isQuestionStart =
      QUESTION_STARTERS_RU.some((q) => normalized.startsWith(q)) ||
      QUESTION_STARTERS_EN.some((q) => normalized.startsWith(q));
    return isQuestionStart;
  }

  // If longer substantive sentence (> 2 words), trigger response
  return true;
}
