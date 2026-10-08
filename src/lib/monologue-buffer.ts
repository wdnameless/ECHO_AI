/**
 * Monologue Buffer.
 *
 * Accumulates non-stop speech segments from conversational partners into
 * a single coherent prompt for AI dispatch.
 *
 * Supports three dispatch modes:
 * - "auto" (default): flushes the whole accumulated chunk when the silence
 *   gap timer fires or when maxWindowMs is reached.
 * - "semi": marks the accumulated chunk as "ready" for confirmation upon silence,
 *   waiting for explicit user confirmation before dispatching.
 * - "manual": accumulates speech continuously until explicit user trigger.
 */
import { similarity } from "./question-assembler";

export type MonologueMode = "auto" | "semi" | "manual";
export type MonologueStatus = "idle" | "accumulating" | "ready";

export interface MonologueSegment {
  text: string;
  timestamp: number;
}

export interface MonologueFlushResult {
  text: string;
  segments: string[];
}

export interface MonologueBufferOptions {
  mode?: MonologueMode;
  maxWindowMs?: number;
  flushGapMs?: number;
  onEmit?: (result: MonologueFlushResult) => void | Promise<void>;
  onStatusChange?: (status: MonologueStatus) => void;
}

export const MONOLOGUE_EVENTS = {
  CONFIRM: "monologue:confirm",
  FLUSH: "monologue:flush",
  CANCEL: "monologue:cancel",
  STATUS_CHANGE: "monologue:status-change",
} as const;

export class MonologueBuffer {
  private segments: MonologueSegment[] = [];
  private mode: MonologueMode;
  private maxWindowMs: number;
  private flushGapMs: number;
  private status: MonologueStatus = "idle";
  private onEmit?: (result: MonologueFlushResult) => void | Promise<void>;
  private onStatusChange?: (status: MonologueStatus) => void;

  constructor(opts: MonologueBufferOptions = {}) {
    this.mode = opts.mode ?? "auto";
    this.maxWindowMs = opts.maxWindowMs ?? 15000;
    this.flushGapMs = opts.flushGapMs ?? 1500;
    this.onEmit = opts.onEmit;
    this.onStatusChange = opts.onStatusChange;
  }

  public getMode(): MonologueMode {
    return this.mode;
  }

  public getStatus(): MonologueStatus {
    return this.status;
  }

  public getMaxWindowMs(): number {
    return this.maxWindowMs;
  }

  public getFlushGapMs(): number {
    return this.flushGapMs;
  }

  public isEmpty(): boolean {
    return this.segments.length === 0;
  }

  public getSegments(): string[] {
    return this.segments.map((s) => s.text);
  }

  public getText(): string {
    return this.segments
      .map((s) => s.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  public reconfigure(opts: Partial<MonologueBufferOptions>): void {
    if (opts.mode !== undefined) this.mode = opts.mode;
    if (opts.maxWindowMs !== undefined) this.maxWindowMs = opts.maxWindowMs;
    if (opts.flushGapMs !== undefined) this.flushGapMs = opts.flushGapMs;
    if (opts.onEmit !== undefined) this.onEmit = opts.onEmit;
    if (opts.onStatusChange !== undefined) this.onStatusChange = opts.onStatusChange;
  }

  private setStatus(newStatus: MonologueStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.onStatusChange?.(newStatus);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(MONOLOGUE_EVENTS.STATUS_CHANGE, {
            detail: { status: newStatus, text: this.getText() },
          })
        );
      }
    }
  }

  /**
   * Pushes a new speech segment into the buffer.
   * Discards immediate duplicates or trailing repeats from speech recognition.
   */
  public push(
    text: string,
    timestamp: number = Date.now()
  ): { text: string; shouldEmit: boolean; windowExceeded: boolean } {
    const trimmed = text.trim();
    if (!trimmed) {
      return { text: this.getText(), shouldEmit: false, windowExceeded: false };
    }

    // Duplicate suppression against previous segment
    if (this.segments.length > 0) {
      const last = this.segments[this.segments.length - 1];
      if (similarity(last.text, trimmed) >= 0.8) {
        return { text: this.getText(), shouldEmit: false, windowExceeded: false };
      }
    }

    this.segments.push({ text: trimmed, timestamp });

    const firstTs = this.segments[0].timestamp;
    const duration = timestamp - firstTs;
    const windowExceeded = duration >= this.maxWindowMs;

    if (this.status === "idle" || this.status === "ready") {
      this.setStatus("accumulating");
    }

    const shouldEmit = this.mode === "auto" && windowExceeded;

    return {
      text: this.getText(),
      shouldEmit,
      windowExceeded,
    };
  }

  /**
   * Called when a silence gap has elapsed.
   * In auto mode: flushes and emits the chunk.
   * In semi mode: marks the buffer as ready for user confirmation.
   * In manual mode: remains in accumulating state.
   */
  public onSilenceGap(): MonologueFlushResult | null {
    if (this.isEmpty()) return null;

    if (this.mode === "auto") {
      return this.flush();
    }

    if (this.mode === "semi") {
      this.setStatus("ready");
      return null;
    }

    // manual mode: do not flush on silence
    return null;
  }

  /**
   * Confirms and flushes the pending monologue.
   * Used in semi-confirm mode, or as an explicit trigger in manual/auto mode.
   */
  public confirm(): MonologueFlushResult | null {
    return this.flush();
  }

  /**
   * Flushes all accumulated segments into one text and resets the buffer.
   */
  public flush(): MonologueFlushResult | null {
    if (this.isEmpty()) {
      this.setStatus("idle");
      return null;
    }

    const text = this.getText();
    const segments = this.getSegments();
    const result: MonologueFlushResult = { text, segments };

    this.segments = [];
    this.setStatus("idle");

    if (this.onEmit) {
      void this.onEmit(result);
    }

    return result;
  }

  /**
   * Cancels and clears the buffer without emitting.
   */
  public clear(): void {
    this.segments = [];
    this.setStatus("idle");
  }
}

/** Dispatches a custom window event to confirm pending monologue */
export function dispatchMonologueConfirm(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MONOLOGUE_EVENTS.CONFIRM));
  }
}

/** Dispatches a custom window event to manually flush current monologue */
export function dispatchMonologueFlush(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MONOLOGUE_EVENTS.FLUSH));
  }
}

/** Dispatches a custom window event to cancel current monologue */
export function dispatchMonologueCancel(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MONOLOGUE_EVENTS.CANCEL));
  }
}
