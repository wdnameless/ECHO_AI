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

/** How long after an emitted question a short tail can still be its continuation. */
const FOLLOWUP_MERGE_MS = 20_000;

export class QuestionAssembler {
  private pending: PendingState | null = null;
  private lastEmitted: { text: string; ts: number } | null = null;
  private readonly gapMs: number;
  private readonly maxWindowMs: number;
  private readonly immediateOnQuestionMark: boolean;
  private readonly similarityThreshold: number;

  constructor(opts: QuestionAssemblerOptions = {}) {
    this.gapMs = opts.gapMs ?? 1500;
    this.maxWindowMs = opts.maxWindowMs ?? 12000;
    this.immediateOnQuestionMark = opts.immediateOnQuestionMark ?? true;
    this.similarityThreshold = opts.duplicateSimilarityThreshold ?? 0.8;
  }

  get current(): { source: string; text: string } | null {
    if (!this.pending) return null;
    return { source: this.pending.source, text: this.pending.segments.join(" ") };
  }

  /**
   * A fragment is a self-contained question when it clearly stands on its
   * own: ends with "?", opens with a question word, or is long. Anything
   * else ("то есть", "а подробнее", "и про командную работу") that arrives
   * shortly after an answered question is treated as its continuation and
   * merged with the parent question so the AI never answers a meaningless
   * tail without context.
   */
  private isFollowUpTail(text: string): boolean {
    if (!this.lastEmitted) return false;
    if (Date.now() - this.lastEmitted.ts > FOLLOWUP_MERGE_MS) return false;
    if (text.endsWith("?")) return false;
    if (text.length >= 90) return false;
    return !/^(почему|зачем|как|что|кто|где|когда|сколько|какой|какая|какие|расскажи|объясни|опиши|расскажи|what|how|why|where|when|who|which|can|could|would|tell|describe|explain|do|does|did|have|has)\b/i.test(
      text
    );
  }

  private startPending(
    segment: QuestionFragment,
    seedText?: string
  ): PendingState {
    this.pending = {
      source: segment.source,
      segments: seedText ? [seedText, segment.text.trim()] : [segment.text.trim()],
      firstTs: segment.timestamp,
      lastTs: segment.timestamp,
    };
    return this.pending;
  }

  /** Feeds a new (final) segment and decides what to do with it. */
  push(segment: QuestionFragment): PushResult {
    const text = segment.text.trim();
    if (!text) {
      return { kind: "discarded", reason: "empty" };
    }

    const p = this.pending;
    if (!p || p.source !== segment.source) {
      // New utterance (or new speaker). A short non-question tail shortly
      // after an answered question is merged with its parent question.
      const seed =
        !p && this.isFollowUpTail(text) ? this.lastEmitted!.text : undefined;
      this.startPending(segment, seed);
      const question = this.pending!.segments.join(" ");
      if (this.immediateOnQuestionMark && text.endsWith("?")) {
        return this.emit();
      }
      return { kind: "pending", question };
    }

    // Same source, continuing the same utterance?
    const gap = segment.timestamp - p.lastTs;
    if (gap > this.gapMs) {
      // Long pause. If the pending text was already emitted and answered,
      // this fragment may be a follow-up tail - merge it with the parent.
      const seed = this.isFollowUpTail(text) ? this.lastEmitted!.text : undefined;
      this.startPending(segment, seed);
      const question = this.pending!.segments.join(" ");
      if (this.immediateOnQuestionMark && text.endsWith("?")) {
        return this.emit();
      }
      return { kind: "pending", question };
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
    this.lastEmitted = null;
  }

  private emit(): PushResult {
    const p = this.pending!;
    const question = p.segments.join(" ").trim();
    const segments = p.segments;
    this.pending = null;
    if (!question) {
      return { kind: "discarded", reason: "empty" };
    }
    this.lastEmitted = { text: question, ts: Date.now() };
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
