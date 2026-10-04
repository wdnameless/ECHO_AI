/**
 * Boilerplate the recogniser invents when it is handed audio that holds no
 * speech — silence, music, a hold tone, dialogue-free video.
 *
 * Whisper-family models were trained on subtitled video, so with nothing to
 * transcribe they emit what a subtitle track ends with: credits. Measured on the
 * live screen, the feed showed «Субтитры сделал DimaTorzok» as the interviewer's
 * own line and the AI answered it.
 *
 * Scrubbed rather than matched whole, because the credits are spliced INTO real
 * speech as often as they replace it. The live feed read:
 *
 *   «Okay. Whoa. Hey, what? Субтитры сделал DimaTorzok Тогда бы тут ты не появился.»
 *
 * Here the first and last parts are what the person said; the credits sit in the
 * middle. Removing the phrase keeps the sentence and loses nothing.
 */

/**
 * Phrases that only ever appear in a subtitle credit.
 *
 * No pattern consumes arbitrary following words. An unbounded run
 * (`[^.,;!?]*`) and even a one-token run (`(?:\s+\S+){0,1}`) both ate the speech
 * that followed a credit: in «Hey, what? Субтитры сделал DimaTorzok Тогда бы тут
 * ты не появился.» there is no punctuation between the nickname and the next
 * sentence, so «Тогда» — a real word — was swallowed. What remains after these
 * patterns is the credit PHRASE, which is what made the AI answer the credits;
 * a leftover nickname is cosmetic and costs no speech.
 *
 * A trailing `\b` cannot be used on Cyrillic: in JS `\b` is ASCII-based, so it
 * never matches after «сделал» and the pattern silently did nothing.
 * `(?!\p{L})` expresses the same "end of word" and works for any script.
 */
const CREDIT_PATTERNS: readonly RegExp[] = [
  // The nickname form the live feed produced, including "Dima Torzok" spaced.
  /\bdima\s*[-_]?\s*torzok\b/giu,
  // «Субтитры сделал DimaTorzok» — the phrase alone; the name is covered above.
  /субтитры\s+(?:сделал|создал|подогнал|перевёл|перевел|оформил)(?!\p{L})/giu,
  /субтитры\s+сообщества(?!\p{L})/giu,
  // «Редактор субтитров А.Синецкая» / «Корректор А.Егорова» — the name in this
  // form is distinctive: an initial, a dot, then the surname.
  /(?:редактор|корректор)\s+(?:субтитров\s+)?\p{Lu}\.\p{L}+/giu,
  /(?:редактор|корректор)\s+субтитров(?!\p{L})/giu,
  /\bamara\.org(?:\s+community)?(?!\p{L})/giu,
  /\bopensubtitles\b/giu,
  /\b(?:subtitles|subtitled|transcription)\s+by(?:\s+(?:the|a|an))?(?!\p{L})/giu,
  /\bthanks?\s+(?:you\s+)?for\s+watching\b/giu,
  /\bplease\s+subscribe\b/giu,
  // Purple-prose hallucinations: the engine narrates instead of transcribing.
  // Seen live: "Фиолетовая тряпочка говорит о том, что он покончил с собой"
  // for EN audio ("Shooting him"), and "Фиолетовый" as a standalone opener.
  // The narration runs to the sentence end, so consume the whole clause, not
  // a fixed word window (a {0,3} window left "том, что он покончил с собой").
  // NOTE: \w is ASCII-only, so Cyrillic word tails need \S* (non-space run).
  /фиолетов\S*[^.!?…]*[.!?…]?/giu,
];

/**
 * Standalone phrases that are also ordinary speech, so they count only as the
 * whole line. «Продолжение следует» is a normal way to end a thought, and
 * "to be continued" is a normal phrase mid-sentence ("I think to be continued
 * tomorrow is fine") — each is boilerplate only when nothing else was said.
 */
const WHOLE_LINE_BOILERPLATE: readonly RegExp[] = [
  /^продолжение\s+следует[.!?…]*$/iu,
  /^to\s+be\s+continued[.!?…]*$/iu,
];

/**
 * Removes recogniser boilerplate and returns what the person actually said.
 *
 * An empty result means the model produced nothing but credits — the caller
 * treats that as "no speech", which is what it is.
 */
export function scrubAsrHallucinations(text: string | null | undefined): string {
  if (!text) return "";
  let line = text.replace(/\s+/g, " ").trim();
  if (!line) return "";

  for (const pattern of CREDIT_PATTERNS) {
    pattern.lastIndex = 0;
    line = line.replace(pattern, " ");
  }

  // The removal leaves the punctuation and spaces that framed the credit —
  // «что? , Тогда» — so collapse runs and drop stray separators.
  line = line
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;!?…])/g, "$1")
    .replace(/([.,;!?…])\s*([.,;!?…])+/g, "$1")
    .replace(/^[\s.,;!?…]+/, "")
    .trim();

  // Checked AFTER scrubbing: «Продолжение следует. Субтитры сделал DimaTorzok»
  // is boilerplate only once the credit is gone and nothing else remains.
  for (const pattern of WHOLE_LINE_BOILERPLATE) {
    if (pattern.test(line)) return "";
  }

  return line;
}

/** True when the text was nothing but recogniser boilerplate. */
export function isAsrHallucination(text: string | null | undefined): boolean {
  return Boolean(text && text.trim()) && scrubAsrHallucinations(text) === "";
}
