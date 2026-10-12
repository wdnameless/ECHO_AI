/**
 * Speech filter utilities to distinguish between conversational fillers/backchannels
 * (e.g., "угу", "мгм", "ага", "yeah", "uh-huh") and actual questions or substantive queries.
 */

/**
 * Letters whose repetition is a filler sound rather than a word.
 *
 * The recogniser writes a lengthened hesitation out ("ммм", "эээ", "ааа",
 * "hmmm"), which an exact-match list cannot cover. Only letters that are filler
 * sounds on their own are listed, so repeated real words ("ии", "вв") — rare, but
 * not filler — stay untouched.
 */
const STRETCHED_FILLER_LETTERS = new Set(["м", "э", "а", "о", "х", "у", "h", "m", "e", "u", "a", "o"]);

/**
 * A filler sound written out: one letter repeated ("ммм", "эээ", "аааа"), or a
 * consonant hum closed by a nasal ("hmm", "hmmm", "hnn", "хмм"). The recogniser emits
 * these forms, and none is a word in either language.
 */
const STRETCHED_WORD = /^(.)\1{1,6}$/u;
const HUMMED_WORD = /^(?:[hmn]{2,6}|[хмнэа]{2,6})$/u;
const HYPHEN_STRETCHED = /^[\p{L}]+(?:-[\p{L}]+)+$/u;

/** True for a sound that is only a hesitation, never a word. Exported for reuse by speech-style counting. */
export function isStretchedFiller(word: string): boolean {
  const lower = word.toLowerCase();
  if (STRETCHED_WORD.test(lower)) return STRETCHED_FILLER_LETTERS.has(lower[0]);
  if (HUMMED_WORD.test(lower)) return true;
  if (HYPHEN_STRETCHED.test(lower)) {
    const parts = lower.split("-");
    if (parts.length >= 2 && parts.every((p) => p === parts[0] || p.length === 1)) {
      return STRETCHED_FILLER_LETTERS.has(parts[0][0]) || parts[0] === "ну";
    }
  }
  return false;
}

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
  "спроектируй",
  "спроектируйте",
  "разработай",
  "разработайте",
  "построй",
  "постройте",
  "реализуй",
  "реализуйте",
  "архитектура",
  "дизайн",
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
  "design",
  "architect",
  "build",
  "implement",
  "create",
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

  // A stretched filler sound: the recogniser writes the lengthened vowel out
  // ("ммм", "эээ", "аааа", "hmmm"), so the exact-match list above misses the
  // most common backchannel there is — every one of them was reaching the AI as
  // a question. Collapse a run of one letter and match it against the one-letter
  // fillers ("м", "э", "а", "h"), keeping real short words like "и" or "в"
  // untouched because those are not filler sounds.
  const collapsed = normalized.replace(/\s+/g, "");
  if (isStretchedFiller(collapsed)) return true;

  // Check if utterance is just 1 or 2 repeated filler words (e.g. "угу угу", "да да")
  const words = normalized.split(" ").filter(Boolean);
  if (words.length <= 3) {
    const allFillers = words.every(
      (w) => FILLER_PATTERNS.has(w) || w.length <= 2 || isStretchedFiller(w)
    );
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
