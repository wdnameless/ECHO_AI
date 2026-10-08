import { safeLocalStorage } from "./storage/helper";
import { isFillerOrBackchannel } from "./speech-filter";
import { getAnswerMode, type AnswerMode } from "./answer-mode";

export type AutoAskMode = "auto" | "manual";

export type AutoAskTarget = "interview" | "code";

/**
 * Resolves whether an auto-ask question should route into the standard interview
 * prompt or into the livecode code prompt without manual clicks.
 */
export function resolveAutoAskTarget(mode?: AnswerMode): AutoAskTarget {
  const current = mode ?? getAnswerMode();
  return current === "livecode" ? "code" : "interview";
}

export interface AutoAskConfig {
  enabled: boolean;
  silenceDurationMs: number;
  mode: AutoAskMode;
}

export const AUTO_ASK_STORAGE_KEYS = {
  ENABLED: "auto_ask_enabled",
  SILENCE_DURATION: "auto_ask_silence_duration_ms",
  MODE: "auto_ask_mode",
} as const;

/// Auto answering is the behaviour users already expect from the meeting panel;
/// the mode switch is what turns it off, so `enabled` only stays for configs
/// written by older builds.
export const DEFAULT_AUTO_ASK_CONFIG: AutoAskConfig = {
  enabled: true,
  silenceDurationMs: 1000,
  mode: "auto",
};

export const AUTO_ASK_MIN_SILENCE_MS = 500;
export const AUTO_ASK_MAX_SILENCE_MS = 5000;

/**
 * How long a dispatched question stays eligible for repeat suppression.
 *
 * A long utterance is emitted more than once (the assembler flushes on a pause
 * and the next flush carries the earlier text plus the new tail), and those
 * emissions arrive within seconds of each other. The same words much later are
 * a genuinely new question — an interviewer repeating themselves on purpose —
 * so the guard must not be permanent.
 */
const REPEAT_GUARD_MS = 30_000;

export function clampSilenceDuration(ms: number): number {
  if (Number.isNaN(ms) || !Number.isFinite(ms)) {
    return DEFAULT_AUTO_ASK_CONFIG.silenceDurationMs;
  }
  return Math.min(Math.max(ms, AUTO_ASK_MIN_SILENCE_MS), AUTO_ASK_MAX_SILENCE_MS);
}

export function getAutoAskConfig(): AutoAskConfig {
  const enabledRaw = safeLocalStorage.getItem(AUTO_ASK_STORAGE_KEYS.ENABLED);
  const silenceRaw = safeLocalStorage.getItem(AUTO_ASK_STORAGE_KEYS.SILENCE_DURATION);
  const modeRaw = safeLocalStorage.getItem(AUTO_ASK_STORAGE_KEYS.MODE);

  const enabled = enabledRaw !== null ? enabledRaw === "true" : DEFAULT_AUTO_ASK_CONFIG.enabled;
  let silenceDurationMs = DEFAULT_AUTO_ASK_CONFIG.silenceDurationMs;

  if (silenceRaw !== null) {
    const parsed = parseInt(silenceRaw, 10);
    if (!Number.isNaN(parsed)) {
      silenceDurationMs = clampSilenceDuration(parsed);
    }
  }

  const mode: AutoAskMode =
    modeRaw === "manual" || modeRaw === "auto" ? modeRaw : DEFAULT_AUTO_ASK_CONFIG.mode;

  return {
    enabled,
    silenceDurationMs,
    mode,
  };
}

export function saveAutoAskConfig(config: Partial<AutoAskConfig>): AutoAskConfig {
  const current = getAutoAskConfig();
  const next: AutoAskConfig = {
    enabled: typeof config.enabled === "boolean" ? config.enabled : current.enabled,
    silenceDurationMs:
      typeof config.silenceDurationMs === "number"
        ? clampSilenceDuration(config.silenceDurationMs)
        : current.silenceDurationMs,
    mode: config.mode === "auto" || config.mode === "manual" ? config.mode : current.mode,
  };

  safeLocalStorage.setItem(AUTO_ASK_STORAGE_KEYS.ENABLED, String(next.enabled));
  safeLocalStorage.setItem(AUTO_ASK_STORAGE_KEYS.SILENCE_DURATION, String(next.silenceDurationMs));
  safeLocalStorage.setItem(AUTO_ASK_STORAGE_KEYS.MODE, next.mode);

  return next;
}

export interface ShouldAutoAskParams {
  enabled?: boolean;
  mode?: AutoAskMode;
  text: string;
  isAIProcessing: boolean;
}

/**
 * Validates if the given finalized transcript passes all guards to be automatically dispatched to AI.
 */
export function shouldAutoAsk(params: ShouldAutoAskParams): boolean {
  const { enabled = true, mode = "auto", text, isAIProcessing } = params;

  if (enabled === false || mode === "manual") {
    return false;
  }

  if (isAIProcessing) {
    return false;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  if (isFillerOrBackchannel(trimmed)) {
    return false;
  }

  return true;
}

export interface AutoAskManagerOptions {
  getConfig?: () => AutoAskConfig;
  onDispatch: (text: string, target?: AutoAskTarget) => void | Promise<void>;
  onDispatchCode?: (text: string) => void | Promise<void>;
  isAIProcessing: () => boolean;
  getAnswerMode?: () => AnswerMode;
}

/**
 * Manages utterance completion and silence timeout for automatic AI query dispatch.
 */
export class AutoAskManager {
  private timer: NodeJS.Timeout | number | null = null;
  private pendingText: string | null = null;
  /**
   * A question heard while the AI was still answering.
   *
   * The interviewer keeps talking during an answer, and the eligibility check
   * rejects anything that arrives while `isAIProcessing` is true — so every
   * such question was dropped outright, never asked and never heard again.
   * One is kept here and dispatched when the answer finishes.
   */
  private heldText: string | null = null;
  /**
   * The last question actually dispatched.
   *
   * Used to recognise the same utterance arriving again as it grows (see
   * `isRepeatOfAsked`) — the automatic path had no equivalent of the manual
   * path's utterance-id guard, so one thought could be answered several times.
   */
  private lastAskedText: string | null = null;
  /** When `lastAskedText` was dispatched, for the guard's time window. */
  private lastAskedAt = 0;
  private options: AutoAskManagerOptions;

  constructor(options: AutoAskManagerOptions) {
    this.options = options;
  }

  public updateOptions(options: Partial<AutoAskManagerOptions>): void {
    this.options = {
      ...this.options,
      ...options,
    };
  }

  /**
   * Dispatches a question whose silence has already been confirmed.
   *
   * The assembler emits only after the speaker has been silent for its own gap
   * (450ms in fast mode), so re-holding the text for the manager's window added
   * a second full wait to every answer: measured 450ms + 1000ms = 1450ms before
   * the request even started. The eligibility checks still apply — a reaction
   * or a filler is dropped here exactly as it was in the timer path.
   */
  public dispatchNow(text: string): void {
    this.cancelTimer();
    this.pendingText = null;

    // Mode / enabled / filler checks still apply. Only `isAIProcessing` is
    // treated differently below: it is a "not now", not a "never".
    const config = this.options.getConfig
      ? this.options.getConfig()
      : getAutoAskConfig();
    if (config.enabled === false || config.mode === "manual") return;
    if (isFillerOrBackchannel(text)) return;

    // The same question, heard again as it grows, must not be answered twice.
    //
    // A long utterance is emitted more than once: the assembler flushes on a
    // pause, the interviewer keeps talking, and the next flush carries the
    // earlier text plus the new tail. Each emission was dispatched, so one
    // thought produced several answers in the stored conversation — measured
    // three answers to «Ты не виноват.» as the sentence grew, each with its own
    // AI response. The manual "Ответить" path already refuses a repeat by
    // utterance id; the automatic path had no such check.
    //
    // Containment, not equality: the repeat is a superstring of what was asked,
    // so it adds the tail only. The longer text is what gets asked, and the
    // shorter one is dropped as already covered.
    if (this.isRepeatOfAsked(text)) return;

    // A real question that arrives mid-answer is held, not discarded.
    if (this.options.isAIProcessing()) {
      this.heldText = text.trim();
      return;
    }
    this.noteAsked(text);
    this.dispatchTarget(text);
  }

  /** True when `text` repeats a question already dispatched. */
  private isRepeatOfAsked(text: string): boolean {
    const asked = this.lastAskedText;
    if (!asked) return false;
    // Bounded, like every other continuation check in the app: only a repeat
    // that arrives while the speaker is still on the same thought is the same
    // utterance heard twice. The same words a minute later are a new question.
    if (Date.now() - this.lastAskedAt > REPEAT_GUARD_MS) return false;
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
    const a = norm(asked);
    const b = norm(text);
    if (!a || !b) return false;
    // Short lines ("Да.", "Угу.") legitimately recur and are filtered as
    // fillers anyway; only substantial text decides.
    if (a.split(" ").filter(Boolean).length < 3) return false;
    if (b.includes(a) || a.includes(b)) return true;
    // A re-read with different wording still shares most of its words.
    const as = new Set(a.split(" ").filter(Boolean));
    const bs = new Set(b.split(" ").filter(Boolean));
    let inter = 0;
    for (const w of as) if (bs.has(w)) inter++;
    return inter / new Set([...as, ...bs]).size >= 0.8;
  }

  /** Record a dispatch so the next emission can recognise a repeat of it. */
  private noteAsked(text: string): void {
    this.lastAskedText = text.trim();
    this.lastAskedAt = Date.now();
  }

  /**
   * Flushes a question that was held during an answer.
   *
   * Call this when the AI finishes: without it the held question would sit
   * forever, which is the same silence the queue exists to remove.
   */
  public releaseHeld(): void {
    const text = this.heldText;
    this.heldText = null;
    if (!text) return;
    if (this.options.isAIProcessing()) {
      // Still busy (a new answer started first): keep holding it.
      this.heldText = text;
      return;
    }
    this.dispatchTarget(text);
  }

  /** True when a question is waiting for the current answer to finish. */
  public hasHeld(): boolean {
    return this.heldText !== null;
  }

  /**
   * Holds a question the user asked while an answer was streaming.
   *
   * Separate from `dispatchNow` because the caller has already established that
   * the text is worth asking (the manual "Ответить" path checks its own
   * eligibility); this only parks it.
   */
  public hold(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.heldText = trimmed;
  }

  /**
   * Called when a finalized segment or partial speech event arrives.
   * Debounces the dispatch until silence duration completes.
   */
  public onFinalizedTranscript(
    text: string,
    options?: { confirmedSilence?: boolean }
  ): void {
    if (options?.confirmedSilence) {
      this.dispatchNow(text);
      return;
    }
    if (!this.isEligible(text)) {
      this.cancel();
      return;
    }

    this.pendingText = text.trim();
    this.cancelTimer();

    const config = this.options.getConfig ? this.options.getConfig() : getAutoAskConfig();
    this.timer = setTimeout(() => {
      this.flush();
    }, config.silenceDurationMs);
  }

  public flush(): void {
    const textToDispatch = this.pendingText;
    this.cancelTimer();
    this.pendingText = null;

    if (!textToDispatch || !this.isEligible(textToDispatch)) return;

    // The timer path reaches `onDispatch` directly, so it needs the same
    // repeat guard as `dispatchNow` — otherwise a grown question re-asked by
    // the timer would still produce a second answer.
    if (this.isRepeatOfAsked(textToDispatch)) return;
    this.noteAsked(textToDispatch);
    this.dispatchTarget(textToDispatch);
  }

  private isEligible(text: string): boolean {
    const config = this.options.getConfig ? this.options.getConfig() : getAutoAskConfig();
    // `mode` is authoritative; `enabled` only survives for configs written by
    // older builds, so a stale flag cannot silence the Авто switch.
    return shouldAutoAsk({
      mode: config.mode,
      text,
      isAIProcessing: this.options.isAIProcessing(),
    });
  }

  public cancel(): void {
    this.cancelTimer();
    this.pendingText = null;
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private dispatchTarget(text: string): void {
    const mode = this.options.getAnswerMode
      ? this.options.getAnswerMode()
      : getAnswerMode();
    const target = resolveAutoAskTarget(mode);
    if (target === "code" && this.options.onDispatchCode) {
      void this.options.onDispatchCode(text);
    } else if (target === "code") {
      void this.options.onDispatch(text, "code");
    } else {
      void this.options.onDispatch(text);
    }
  }
}
