/**
 * In-memory performance and reliability metrics module.
 *
 * Tracks:
 * - TTFT (Time to First Token: question finalized -> first token of AI response)
 * - WS reconnect counts
 * - Lost audio segment counts
 * - STT inference duration (ms)
 *
 * Provides a pub/sub listener interface similar to asr-status.
 */

export interface SystemMetrics {
  /** Last measured TTFT in milliseconds (null if not yet measured) */
  lastTtftMs: number | null;
  /** Average TTFT across recorded turns in milliseconds */
  avgTtftMs: number | null;
  /** Total number of recorded TTFT samples */
  ttftSamplesCount: number;
  /** Total WebSocket reconnect attempts */
  wsReconnectCount: number;
  /** Total lost / dropped audio segments */
  lostSegmentsCount: number;
  /** Last measured STT inference duration in milliseconds */
  lastSttDurationMs: number | null;
  /** Average STT inference duration in milliseconds */
  avgSttDurationMs: number | null;
  /** Total number of recorded STT duration samples */
  sttSamplesCount: number;
  /** Timestamp of last metric update */
  updatedAt: number;
}

export type MetricsSnapshot = SystemMetrics;
type MetricsListener = (m: SystemMetrics) => void;

let metricsState: SystemMetrics = {
  lastTtftMs: null,
  avgTtftMs: null,
  ttftSamplesCount: 0,
  wsReconnectCount: 0,
  lostSegmentsCount: 0,
  lastSttDurationMs: null,
  avgSttDurationMs: null,
  sttSamplesCount: 0,
  updatedAt: 0,
};

let totalTtftSum = 0;
let totalSttSum = 0;
let questionFinalizedAt: number | null = null;
const listeners = new Set<MetricsListener>();
function emit(): void {
  for (const cb of Array.from(listeners)) {
    try {
      cb(metricsState);
    } catch {
      /* isolate faulty listeners */
    }
  }
}

/**
 * Get the current snapshot of metrics.
 */
export function getMetrics(): SystemMetrics {
  return metricsState;
}

/**
 * Subscribe to metrics updates. Delivers current snapshot immediately.
 */
export function onMetrics(cb: MetricsListener): () => void {
  listeners.add(cb);
  try {
    cb(metricsState);
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Record a TTFT measurement (ms).
 */
export function recordTtft(ttftMs: number): void {
  if (typeof ttftMs !== "number" || isNaN(ttftMs) || ttftMs < 0) return;
  const count = metricsState.ttftSamplesCount + 1;
  totalTtftSum += ttftMs;
  metricsState = {
    ...metricsState,
    lastTtftMs: Math.round(ttftMs),
    avgTtftMs: Math.round(totalTtftSum / count),
    ttftSamplesCount: count,
    updatedAt: Date.now(),
  };
  emit();
}

/**
 * Record a STT inference duration measurement (ms).
 */
export function recordSttDuration(durationMs: number): void {
  if (typeof durationMs !== "number" || isNaN(durationMs) || durationMs < 0) return;
  const count = metricsState.sttSamplesCount + 1;
  totalSttSum += durationMs;
  metricsState = {
    ...metricsState,
    lastSttDurationMs: Math.round(durationMs),
    avgSttDurationMs: Math.round(totalSttSum / count),
    sttSamplesCount: count,
    updatedAt: Date.now(),
  };
  emit();
}

/**
 * Increment the WS reconnect counter.
 */
export function recordWsReconnect(amount = 1): void {
  metricsState = {
    ...metricsState,
    wsReconnectCount: metricsState.wsReconnectCount + Math.max(1, amount),
    updatedAt: Date.now(),
  };
  emit();
}

/**
 * Increment the lost segments counter.
 */
export function recordLostSegment(amount = 1): void {
  metricsState = {
    ...metricsState,
    lostSegmentsCount: metricsState.lostSegmentsCount + Math.max(1, amount),
    updatedAt: Date.now(),
  };
  emit();
}

/**
 * Mark that a user/interviewer question has finalized (begins TTFT timer).
 */
export function startQuestion(timestamp: number = Date.now()): void {
  questionFinalizedAt = timestamp;
}

/**
 * Record the first received token of the AI answer (completes TTFT timer).
 */
export function recordFirstToken(now: number = Date.now()): number | null {
  if (questionFinalizedAt === null) {
    return null;
  }
  const ttftMs = Math.max(0, now - questionFinalizedAt);
  questionFinalizedAt = null;
  recordTtft(ttftMs);
  return ttftMs;
}

/**
 * Cancel an in-flight question timer without recording a TTFT measurement.
 */
export function cancelQuestion(): void {
  questionFinalizedAt = null;
}

/**
 * Reset metrics (useful for tests or session start).
 */
export function resetMetrics(): void {
  totalTtftSum = 0;
  totalSttSum = 0;
  metricsState = {
    lastTtftMs: null,
    avgTtftMs: null,
    ttftSamplesCount: 0,
    wsReconnectCount: 0,
    lostSegmentsCount: 0,
    lastSttDurationMs: null,
    avgSttDurationMs: null,
    sttSamplesCount: 0,
    updatedAt: Date.now(),
  };
  questionFinalizedAt = null;
  emit();
}
