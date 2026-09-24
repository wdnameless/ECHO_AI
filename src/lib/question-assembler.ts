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
// ASR Timing Modes Configuration
//
// README:
// Two timing presets govern how the interviewer's speech stream is assembled
// into questions and emitted to the AI pipeline:
//
// - "fast" (answer-first mode):
//     Optimized for minimum latency during real-time interviews.
//     Lowers the question-flush gap timer from 1500ms / 800ms down to 450ms (~330-450ms)
//     so that when an interviewer stops speaking, AI inference triggers almost instantly.
//     Early-pause emission triggers at 500ms (`earlyEmitPauseMs = 500`).
//     Aggressive reduction below 450ms is avoided to prevent cutting pauses inside
//     complex multi-clause questions. Continuation punctuation protection prevents
//     premature dispatch if the utterance ends with trailing comma, hyphen, or ellipsis.
//
// - "accurate" (default conversational mode):
//     Preserves standard conversational pacing.
//     Uses a 1500ms gap timer before flushing and a longer accumulation window
//     (6000ms - 12000ms) with no aggressive early-pause emission.
//
// Both presets preserve full duplicate-fragment suppression (similarity >= 0.75-0.8)
// and FOLLOWUP_MERGE_MS context continuation.
// ---------------------------------------------------------------------------

export type AsrTimingMode = "accurate" | "fast";

/**
 * Default silence window (ms) for fast-path assembly.
 * Tuned to 800ms to eliminate premature VAD flushes and allow natural pauses.
 */
export const DEFAULT_SILENCE_WINDOW_MS = 450;

/** Early pause emission threshold in fast mode (ms) */
export const DEFAULT_EARLY_EMIT_PAUSE_MS = 400;

export interface AsrTimingConfig {
  /** Gap timer (ms) to flush pending question when speaker goes silent */
  flushGapMs: number;
  /** Maximum accumulation window (ms) before force-emitting */
  maxWindowMs: number;
  /** If set, inter-segment pause >= earlyEmitPauseMs triggers early emission */
  earlyEmitPauseMs?: number;
  /** Immediately emit when fragment ends with a question mark "?" */
  immediateOnQuestionMark: boolean;
  /** Duplicate token similarity threshold (0..1) above which fragment is dropped */
  duplicateSimilarityThreshold: number;
}

export const ASR_TIMING_PRESETS: Record<AsrTimingMode, AsrTimingConfig> = {
  accurate: {
    flushGapMs: 1500,
    maxWindowMs: 6000,
    immediateOnQuestionMark: true,
    duplicateSimilarityThreshold: 0.75,
  },
  fast: {
    flushGapMs: DEFAULT_SILENCE_WINDOW_MS, // 450ms (~330-450ms fast path)
    maxWindowMs: 4000,
    earlyEmitPauseMs: DEFAULT_EARLY_EMIT_PAUSE_MS, // 500ms early pause emit
    immediateOnQuestionMark: true,
    duplicateSimilarityThreshold: 0.75,
  },
};

/** Active default ASR timing mode. Controlled by a single constant block (no UI yet). */
export const ACTIVE_ASR_MODE: AsrTimingMode = "fast";

export interface QuestionFragment {
  source: string;
  text: string;
  timestamp: number;
  /**
   * Silence in the AUDIO before this fragment, in ms.
   *
   * `timestamp` is when the text arrived, and recognition lags the audio
   * (measured ~1.1s), so the interval between two arrivals is dominated by how
   * long the second fragment was spoken — not by the silence between them. A
   * 300ms mid-sentence pause followed by a 3s clause therefore looked like a
   * 3s gap and split one question into two answers. When the capture layer
   * knows the real pause it passes it here and this value decides the gap.
   */
  pauseBeforeMs?: number;
}

export interface QuestionAssemblerOptions {
  /** Milliseconds of silence after last fragment before emitting. Defaults to preset flushGapMs. */
  gapMs?: number;
  /** Alias for gapMs (ms) */
  flushGapMs?: number;
  /** Hard cap from the first fragment - emit what we have after that. Defaults to preset maxWindowMs. */
  maxWindowMs?: number;
  /** A fragment ending with "?" emits immediately (no waiting). */
  immediateOnQuestionMark?: boolean;
  /** Duplicate similarity threshold (0..1) - above = drop the fragment. */
  duplicateSimilarityThreshold?: number;
  /** If set, pause between consecutive segments >= earlyEmitPauseMs emits what we have early. */
  earlyEmitPauseMs?: number;
  /** Timing mode preset name to initialize defaults from. */
  mode?: AsrTimingMode;
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

/**
 * A fragment that opens with one of these reads as a question even when the
 * recogniser dropped the closing "?".
 *
 * NOTE: \b does not work around Cyrillic in JS (\w is ASCII-only), so the word
 * boundary is expressed as a non-letter lookahead instead.
 */
const INTERROGATIVE_OPENING =
  /^(почему|зачем|как|что|кто|где|куда|когда|сколько|какой|какая|какие|какое|каким|какими|какого|каких|каком|чем|расскажите|расскажи|объясните|объясни|опишите|опиши|назовите|назови|приведите|приведи|what|how|why|where|when|who|whom|whose|which|can|could|would|should|shall|will|do|does|did|have|has|are|is|were|was|tell|describe|explain|name|list|give)(?=$|[^\p{L}\p{N}])/iu;

export class QuestionAssembler {
  private pending: PendingState | null = null;
  private lastEmitted: { text: string; ts: number } | null = null;
  private readonly gapMs: number;
  private readonly maxWindowMs: number;
  private readonly immediateOnQuestionMark: boolean;
  private readonly similarityThreshold: number;
  private readonly earlyEmitPauseMs?: number;

  constructor(opts: QuestionAssemblerOptions = {}) {
    const preset = opts.mode ? ASR_TIMING_PRESETS[opts.mode] : undefined;
    this.gapMs = opts.flushGapMs ?? opts.gapMs ?? preset?.flushGapMs ?? 1500;
    this.maxWindowMs = opts.maxWindowMs ?? preset?.maxWindowMs ?? 12000;
    this.immediateOnQuestionMark =
      opts.immediateOnQuestionMark ?? preset?.immediateOnQuestionMark ?? true;
    this.similarityThreshold =
      opts.duplicateSimilarityThreshold ?? preset?.duplicateSimilarityThreshold ?? 0.8;
    this.earlyEmitPauseMs = opts.earlyEmitPauseMs ?? preset?.earlyEmitPauseMs;
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
    return !/^(почему|зачем|как|что|кто|где|когда|сколько|какой|какая|какие|расскажи|объясни|опиши|расскажи|what|how|why|where|when|who|which|can|could|would|tell|describe|explain|do|does|did|have|has)(?=$|[^\p{L}\p{N}])/iu.test(
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

  /**
   * Rotates the buffer to a new utterance: the arriving fragment becomes the
   * pending one, optionally seeded with the parent question it continues.
   */
  private rotate(
    segment: QuestionFragment,
    seedText?: string
  ): { question: string; endsWithQuestionMark: boolean } {
    this.startPending(segment, seedText);
    const question = this.pending!.segments.join(" ");
    return {
      question,
      endsWithQuestionMark: this.immediateOnQuestionMark && segment.text.trim().endsWith("?"),
    };
  }

  /**
   * Rotates to a new utterance and returns what the caller must act on: an
   * emission when the fragment closes the new question, otherwise the pending
   * text. Shared by the two rotation paths (new utterance, long pause) so their
   * behaviour cannot drift apart.
   */
  private rotateOrEmit(segment: QuestionFragment, seedText?: string): PushResult {
    const rotated = this.rotate(segment, seedText);
    if (rotated.endsWithQuestionMark) {
      return this.emit();
    }
    return { kind: "pending", question: rotated.question };
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
      return this.rotateOrEmit(segment, seed);
    }

    // Same source, continuing the same utterance?
    // Prefer the pause measured on the AUDIO when the caller knows it: the
    // arrival interval is dominated by recognition lag and speech duration.
    const gap =
      segment.pauseBeforeMs !== undefined
        ? segment.pauseBeforeMs
        : segment.timestamp - p.lastTs;

    // Early emission on pause >= earlyEmitPauseMs (e.g. 400ms in fast mode).
    //
    // Only when the arriving fragment actually STARTS a new question. A pause
    // alone is not an utterance boundary — natural speech pauses 400-600ms
    // mid-sentence — and emitting there split one interviewer utterance into
    // two answers: the AI answered the opening fragment, then the remainder as
    // a fresh question, and the second request aborted the first mid-stream.
    if (
      this.earlyEmitPauseMs !== undefined &&
      gap >= this.earlyEmitPauseMs &&
      QuestionAssembler.startsNewQuestion(text)
    ) {
      // Emit current pending question accumulated before this segment,
      // and start a new pending utterance with the current segment.
      const prevEmitted = this.emit();
      const seed = this.isFollowUpTail(text) ? this.lastEmitted!.text : undefined;
      this.rotate(segment, seed);
      if (prevEmitted.kind === "emitted") {
        return prevEmitted;
      }
    }

    if (gap > this.gapMs) {
      // Long pause. If the pending text was already emitted and answered,
      // this fragment may be a follow-up tail - merge it with the parent.
      const seed = this.isFollowUpTail(text) ? this.lastEmitted!.text : undefined;
      return this.rotateOrEmit(segment, seed);
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

  /**
   * True when a fragment starts a NEW question rather than continuing the
   * previous sentence: it ends with "?" (recognisers often drop it) or opens
   * with an interrogative word.
   *
   * This is the guard the early-pause path needs. A pause alone is not an
   * utterance boundary — natural speech pauses 400-600ms between clauses — so
   * emitting on the pause alone split one interviewer utterance into several
   * answers: the AI answered the opening fragment, then the rest as a fresh
   * question, and the second request aborted the first one mid-stream.
   */
  static startsNewQuestion(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (trimmed.endsWith("?")) return true;
    return INTERROGATIVE_OPENING.test(trimmed);
  }

  /**
   * Returns true if text ends with continuation punctuation (comma, semicolon,
   * em-dash, en-dash, hyphen, or ellipsis) suggesting the speaker paused mid-sentence.
   */
  static hasContinuationPunctuation(text: string): boolean {
    const trimmed = text.trim();
    return /([,;\-—–]|\.\.\.|…)$/.test(trimmed);
  }

  /**
   * True when the accumulated text clearly reads as an unfinished utterance:
   * ASR normalizers strip mid-sentence punctuation, so continuation commas
   * are often missing. A fragment ending in a coordinating/subordinating
   * connector ("и", "но", "что", "который", "because", "and", ...) or having
   * no terminal .!? mark at all is treated as mid-sentence. Question marks
   * and terminal periods end the utterance immediately.
   */
  static looksUnfinished(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (/[.!?…]$/.test(trimmed)) return false;
    if (QuestionAssembler.hasContinuationPunctuation(trimmed)) return true;
    if (QuestionAssembler.startsNewQuestion(trimmed)) return false;
    // No terminal punctuation at all → sentence never properly closed.
    // Only applies to multi-word fragments: a bare "да"/"нет" answer IS a
    // complete utterance and must not be delayed.
    const words = trimmed.split(/\s+/);
    if (words.length < 3) return false;
    return true;
  }

  /**
   * Force-emit whatever is pending (caller's gap timer fired).
   * If protectContinuation is true (default false or optional parameter),
   * questions ending with continuation punctuation (e.g. ',', '-', '...')
   * will NOT be flushed yet to prevent cutting speech mid-sentence.
   */
  flush(source?: string, options?: { allowContinuation?: boolean }): PushResult | null {
    const p = this.pending;
    if (!p) return null;
    if (source !== undefined && p.source !== source) return null;

    // If caller didn't explicitly force emit with allowContinuation=true,
    // check if pending text ends with continuation punctuation OR reads as
    // an unfinished sentence (no terminal .!? on a multi-word fragment).
    // The caller re-arms a longer timer on "pending" instead of cutting
    // the interviewer off mid-phrase.
    if (!options?.allowContinuation) {
      const currentText = p.segments.join(" ").trim();
      if (QuestionAssembler.looksUnfinished(currentText)) {
        return { kind: "pending", question: currentText };
      }
    }

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
