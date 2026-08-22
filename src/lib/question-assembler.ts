// ---------------------------------------------------------------------------
// Question assembler.
//
// During a live interview the VAD cuts speech into short segments. When the
// speaker pauses mid-question ("Tell me about your experience... *pause* ...
// with distributed systems") each fragment arrives as a separate segment.
// This class merges fragments from the same source into ONE question while
// it is still forming, and only releases it as a finished question when:
//   - the text already ends with a question mark (immediate, no waiting), or
//   - a follow-up fragment arrives within `gapMs` (the question keeps
//     growing), or
//   - the whole window exceeds `maxWindowMs` (emit what we have), or
//   - `flush()` is called by the caller's timer.
//
// Duplicate STT fragments (the same words recognized twice) are discarded so
// the final question is not polluted.
// ---------------------------------------------------------------------------

export interface QuestionFragment {
  source: string;
  text: string;
  timestamp: number;
}export interface QuestionAssemblerOptions {
  /** Max gap between fragments to treat them as ONE question. */
  gapMs?: number;
  /** Hard cap from the first fragment - emit what we have after that. */
  maxWindowMs?: number;
  /** A fragment ending with "?" emits immediately (no waiting). */
  immediateOnQuestionMark?: boolean;
  /** Duplicate similarity threshold (0..1) - above = drop the fragment. */
  duplicateSimilarityThreshold?: number;
}

export type PushResult =
  | { kind: "emitted"; question: string; segments: string[] }
  | { kind: "pending"; question: string }
  | { kind: "discarded"; reason: string };

interface PendingState {
  source: string;
  segments: string[];
  firstTs: number;
  lastTs: number;
}

export class QuestionAssembler {
  private pending: PendingState | null = null;
  private readonly gapMs: number;
  private readonly maxWindowMs: number;
  private readonly immediateOnQuestionMark: boolean;
  private readonly similarityThreshold: number;

  constructor(opts: QuestionAssemblerOptions = {}) {
    this.gapMs = opts.gapMs ?? 1500;
    this.maxWindowMs = opts.maxWindowMs ?? 4000;
    this.immediateOnQuestionMark = opts.immediateOnQuestionMark ?? true;
    this.similarityThreshold = opts.duplicateSimilarityThreshold ?? 0.8;
  }

  get current(): { source: string; text: string } | null {
    if (!this.pending) return null;
    return { source: this.pending.source, text: this.pending.segments.join(" ") };
  }

  /** Feeds a new (final) segment and decides what to do with it. */
  push(segment: QuestionFragment): PushResult {
    const text = segment.text.trim();
    if (!text) {
      return { kind: "discarded", reason: "empty" };
    }

    const p = this.pending;
    if (!p || p.source !== segment.source) {
      // New utterance (or new speaker): start fresh.
      this.pending = {
        source: segment.source,
        segments: [text],
        firstTs: segment.timestamp,
        lastTs: segment.timestamp,
      };
      if (this.immediateOnQuestionMark && text.endsWith("?")) {
        return this.emit();
      }
      return { kind: "pending", question: text };
    }

    // Same source, continuing the same utterance?
    const gap = segment.timestamp - p.lastTs;
    if (gap > this.gapMs) {
      // Too long a pause - the previous question was answered already.
      this.pending = {
        source: segment.source,
        segments: [text],
        firstTs: segment.timestamp,
        lastTs: segment.timestamp,
      };
      if (this.immediateOnQuestionMark && text.endsWith("?")) {
        return this.emit();
      }
      return { kind: "pending", question: text };
    }

    // Check for STT duplicates (same fragment recognized twice).
    const currentText = p.segments.join(" ");
    if (similarity(currentText, text) >= this.similarityThreshold) {
      return { kind: "discarded", reason: "duplicate" };
    }

    p.segments.push(text);
    p.lastTs = segment.timestamp;

    // Window too long already - emit what we have.
    if (segment.timestamp - p.firstTs >= this.maxWindowMs) {
      return this.emit();
    }

    const question = p.segments.join(" ");
    if (this.immediateOnQuestionMark && question.endsWith("?")) {
      return this.emit();
    }

    return { kind: "pending", question };
  }

  /** Force-emit whatever is pending (caller's gap timer fired). */
  flush(source?: string): PushResult | null {
    const p = this.pending;
    if (!p) return null;
    if (source !== undefined && p.source !== source) return null;
    return this.emit();
  }

  reset(): void {
    this.pending = null;
  }

  private emit(): PushResult {
    const p = this.pending!;
    const question = p.segments.join(" ").trim();
    const segments = p.segments;
    this.pending = null;
    if (!question) {
      return { kind: "discarded", reason: "empty" };
    }
    return { kind: "emitted", question, segments };
  }
}

/** Simple token-set Jaccard similarity; used to drop STTSTT duplicates. */
export function similarity(a: string, b: string): number {
  const toSet = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
    );
  const sa = toSet(a);
  const sb = toSet(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  const union = new Set([...sa, ...sb]);
  return union.size === 0 ? 0 : inter / union.size;
}
