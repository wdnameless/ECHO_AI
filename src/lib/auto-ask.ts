import { safeLocalStorage } from "./storage/helper";
import { isFillerOrBackchannel } from "./speech-filter";

export type AutoAskMode = "auto" | "manual";

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
  onDispatch: (text: string) => void | Promise<void>;
  isAIProcessing: () => boolean;
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

    // A real question that arrives mid-answer is held, not discarded.
    if (this.options.isAIProcessing()) {
      this.heldText = text.trim();
      return;
    }
    void this.options.onDispatch(text);
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
    void this.options.onDispatch(text);
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
  public onFinalizedTranscript(text: string): void {
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

    void this.options.onDispatch(textToDispatch);
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
}
