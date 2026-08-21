/**
 * Formats raw AI answers into short, readable spoken paragraphs so the
 * candidate (and the interviewer) can easily follow the thought flow.
 *
 * Heuristics:
 * - Split into sentences on ". ", "! ", "? ".
 * - Group sentences into paragraphs of 1-2 sentences.
 * - Break paragraphs on discourse markers ("но", "потому что", "однако",
 *   "кстати", "например", "в итоге", "если", "поэтому") to create
 *   natural pause points.
 */

const BREAK_MARKERS = [
  // Russian discourse markers
  "Но ", "А ", "Однако ", "Потому что ", "Если ", "Когда ",
  "При этом ", "В итоге ", "Поэтому ", "Кстати ", "Например ",
  "В принципе ", "Короче ", "В целом ", "Вообще ", "Смотрите ",
  "Слушайте ", "Хотя ", "На самом деле ", "В общем ",
  // English discourse markers
  "But ", "However ", "So ", "Because ", "If ", "Actually ",
  "Basically ", "Anyway ", "Overall ", "By the way ", "Also ",
  "That said ", "In practice ", "To be honest ", "In general ",
];

/** Normalize whitespace and convert answer into short paragraphs. */
export function formatSpokenAnswer(raw: string): string[] {
  if (!raw) return [];

  // Collapse newlines into single spaces, normalize whitespace
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return [];

  // Split into sentences
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const paragraphs: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length > 0) {
      paragraphs.push(buffer.join(" "));
      buffer = [];
    }
  };

  for (let i = 0; i < sentences.length; i++) {
    buffer.push(sentences[i]);

    const isLast = i === sentences.length - 1;
    const startsNewIdea =
      i < sentences.length - 1 &&
      BREAK_MARKERS.some((m) => sentences[i + 1].startsWith(m));
    const tooLong = buffer.join(" ").length > 110;

    if (isLast || startsNewIdea || tooLong) {
      flush();
    }
  }
  flush();

  return paragraphs;
}
