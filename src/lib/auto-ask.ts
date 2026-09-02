import { safeLocalStorage } from "./storage/helper";
import { isFillerOrBackchannel } from "./speech-filter";

export interface AutoAskConfig {
  enabled: boolean;
  silenceDurationMs: number;
}

export const AUTO_ASK_STORAGE_KEYS = {
  ENABLED: "auto_ask_enabled",
  SILENCE_DURATION: "auto_ask_silence_duration_ms",
} as const;

export const DEFAULT_AUTO_ASK_CONFIG: AutoAskConfig = {
  enabled: false,
  silenceDurationMs: 1500,
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

  const enabled = enabledRaw !== null ? enabledRaw === "true" : DEFAULT_AUTO_ASK_CONFIG.enabled;
  let silenceDurationMs = DEFAULT_AUTO_ASK_CONFIG.silenceDurationMs;

  if (silenceRaw !== null) {
    const parsed = parseInt(silenceRaw, 10);
    if (!Number.isNaN(parsed)) {
      silenceDurationMs = clampSilenceDuration(parsed);
    }
  }

  return {
    enabled,
    silenceDurationMs,
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
  };

  safeLocalStorage.setItem(AUTO_ASK_STORAGE_KEYS.ENABLED, String(next.enabled));
  safeLocalStorage.setItem(AUTO_ASK_STORAGE_KEYS.SILENCE_DURATION, String(next.silenceDurationMs));

  return next;
}

export interface ShouldAutoAskParams {
  enabled: boolean;
  text: string;
  isAIProcessing: boolean;
}

/**
 * Validates if the given finalized transcript passes all guards to be automatically dispatched to AI.
 */
export function shouldAutoAsk(params: ShouldAutoAskParams): boolean {
  const { enabled, text, isAIProcessing } = params;

  if (!enabled) {
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
   * Called when a finalized segment or partial speech event arrives.
   * Debounces the dispatch until silence duration completes.
   */
  public onFinalizedTranscript(text: string): void {
    const config = this.options.getConfig ? this.options.getConfig() : getAutoAskConfig();

    if (!shouldAutoAsk({
      enabled: config.enabled,
      text,
      isAIProcessing: this.options.isAIProcessing(),
    })) {
      this.cancel();
      return;
    }

    this.pendingText = text.trim();
    this.cancelTimer();

    this.timer = setTimeout(() => {
      this.flush();
    }, config.silenceDurationMs);
  }

  public flush(): void {
    const textToDispatch = this.pendingText;
    this.cancelTimer();
    this.pendingText = null;

    if (!textToDispatch) return;

    const config = this.options.getConfig ? this.options.getConfig() : getAutoAskConfig();
    if (!shouldAutoAsk({
      enabled: config.enabled,
      text: textToDispatch,
      isAIProcessing: this.options.isAIProcessing(),
    })) {
      return;
    }

    void this.options.onDispatch(textToDispatch);
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
