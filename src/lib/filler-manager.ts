import fillersData from "@/config/fillers.json";
import { safeLocalStorage } from "./storage/helper";

export interface FillerCategories {
  acknowledgment: string[];
  thinking: string[];
  clarification: string[];
  transition: string[];
}

export interface FillerManagerConfig {
  enabled: boolean;
  latencyThresholdMs: number; // default 1500ms (1.5s)
}

export type FillerStatus = "idle" | "monitoring" | "playing";

export interface FillerState {
  status: FillerStatus;
  activeFiller: string | null;
  isPlaying: boolean;
  latencyMs: number;
}

export type FillerListener = (state: FillerState) => void;

export const FILLER_MANAGER_STORAGE_KEYS = {
  ENABLED: "filler_manager_enabled",
  LATENCY_THRESHOLD: "filler_manager_latency_threshold_ms",
} as const;

export const DEFAULT_FILLER_MANAGER_CONFIG: FillerManagerConfig = {
  enabled: true,
  latencyThresholdMs: 1500,
};

export class FillerManager {
  private static instance: FillerManager | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startTime: number = 0;
  private status: FillerStatus = "idle";
  private isPlaying: boolean = false;
  private currentFiller: string | null = null;
  private config: FillerManagerConfig;
  private listeners: Set<FillerListener> = new Set();
  private phrases: string[] = [];

  constructor(initialConfig?: Partial<FillerManagerConfig>) {
    this.config = {
      ...this.loadConfig(),
      ...initialConfig,
    };
    const data = fillersData as unknown as FillerCategories;
    this.phrases = [
      ...(data.acknowledgment || []),
      ...(data.thinking || []),
      ...(data.clarification || []),
      ...(data.transition || []),
    ];
  }

  public static getInstance(): FillerManager {
    if (!FillerManager.instance) {
      FillerManager.instance = new FillerManager();
    }
    return FillerManager.instance;
  }

  private loadConfig(): FillerManagerConfig {
    const enabledRaw = safeLocalStorage.getItem(FILLER_MANAGER_STORAGE_KEYS.ENABLED);
    const latencyRaw = safeLocalStorage.getItem(FILLER_MANAGER_STORAGE_KEYS.LATENCY_THRESHOLD);

    return {
      enabled: enabledRaw !== null ? enabledRaw === "true" : DEFAULT_FILLER_MANAGER_CONFIG.enabled,
      latencyThresholdMs: latencyRaw ? parseInt(latencyRaw, 10) || 1500 : DEFAULT_FILLER_MANAGER_CONFIG.latencyThresholdMs,
    };
  }

  public updateConfig(newConfig: Partial<FillerManagerConfig>) {
    this.config = { ...this.config, ...newConfig };
    safeLocalStorage.setItem(FILLER_MANAGER_STORAGE_KEYS.ENABLED, String(this.config.enabled));
    safeLocalStorage.setItem(FILLER_MANAGER_STORAGE_KEYS.LATENCY_THRESHOLD, String(this.config.latencyThresholdMs));
  }

  public getConfig(): FillerManagerConfig {
    return { ...this.config };
  }

  public getState(): FillerState {
    const latencyMs = this.startTime > 0 ? Math.max(0, Date.now() - this.startTime) : 0;
    return {
      status: this.status,
      activeFiller: this.currentFiller,
      isPlaying: this.isPlaying,
      latencyMs,
    };
  }

  public getRandomPhrase(): string {
    if (this.phrases.length === 0) return "Секундочку...";
    const idx = Math.floor(Math.random() * this.phrases.length);
    return this.phrases[idx];
  }

  public subscribe(cb: FillerListener): () => void {
    this.listeners.add(cb);
    cb(this.getState());
    return () => this.listeners.delete(cb);
  }

  private notify() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  /**
   * Called when an LLM request starts. Starts latency timer monitoring (> 1.5s).
   */
  public startMonitoring(onTrigger?: (phrase: string) => void) {
    this.stop();
    if (!this.config.enabled) return;

    this.status = "monitoring";
    this.startTime = Date.now();
    this.notify();

    this.timer = setTimeout(() => {
      if (this.status === "monitoring") {
        this.triggerFiller(onTrigger);
      }
    }, this.config.latencyThresholdMs);
  }

  /**
   * Triggers the filler hint shown while the answer is being prepared.
   *
   * Screen only: the app must not speak. A phrase played over the speakers
   * reaches the other side of a call, and no filler is worth that.
   */
  private triggerFiller(onTrigger?: (phrase: string) => void) {
    const phrase = this.getRandomPhrase();
    this.currentFiller = phrase;
    this.status = "playing";
    this.isPlaying = true;
    this.notify();

    if (onTrigger) {
      onTrigger(phrase);
    }

    // One filler per answer: no rotation. The phrase stays on screen until the
    // LLM stream starts (stop()) or the request ends.
  }

  /**
   * Halts filler playback immediately when text stream chunk is received or request completes/aborts.
   */
  public stop() {
    this.status = "idle";
    this.startTime = 0;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.isPlaying = false;
    this.currentFiller = null;
    this.notify();
  }

  public destroy() {
    this.stop();
    this.listeners.clear();
  }

  public getCurrentFiller(): string | null {
    return this.currentFiller;
  }

  public isFillerPlaying(): boolean {
    return this.isPlaying;
  }
}

export const fillerManager = FillerManager.getInstance();
