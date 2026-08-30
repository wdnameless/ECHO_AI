/**
 * Live ASR-sidecar status store (pub/sub, no polling).
 *
 * The pluely-asr sidecar reports liveness + pool occupancy over its WS
 * stream: an explicit `{"type":"status"}` frame on socket open and
 * `sessions_in_use`/`sessions_total` fields embedded in every text/final
 * frame. Any open socket (question loopback, mic) feeds those frames here;
 * UI components subscribe and render without hitting /health on a timer.
 */

export interface AsrStatus {
  online: boolean;
  /** Human-readable model name, e.g. "nemotron-3.5-asr-streaming-0.6b". */
  model: string;
  sessionsInUse: number;
  sessionsTotal: number;
  updatedAt: number;
}

type Listener = (s: AsrStatus) => void;

let status: AsrStatus = {
  online: false,
  model: "",
  sessionsInUse: 0,
  sessionsTotal: 0,
  updatedAt: 0,
};

const listeners = new Set<Listener>();

export function getStatus(): AsrStatus {
  return status;
}

export function onStatus(cb: Listener): () => void {
  listeners.add(cb);
  // Deliver the current snapshot immediately so new subscribers render
  // without waiting for the next WS frame.
  try {
    cb(status);
  } catch {
    /* listener errors must not break the store */
  }
  return () => {
    listeners.delete(cb);
  };
}

function emit(): void {
  for (const cb of Array.from(listeners)) {
    try {
      cb(status);
    } catch {
      /* isolate faulty listeners */
    }
  }
}

/**
 * Feed an inbound WS frame from either stream (them/mic) into the store.
 * Accepts:
 *  - `{"type":"status","online":true,"model":...,"sessions_in_use":N,"sessions_total":M}`
 *  - any text/final frame carrying `sessions_in_use`/`sessions_total`
 */
export function pushFrame(v: unknown): void {
  if (!v || typeof v !== "object") return;
  const frame = v as Record<string, unknown>;

  const type = typeof frame.type === "string" ? frame.type : "";
  const hasCounts =
    typeof frame.sessions_in_use === "number" ||
    typeof frame.sessions_total === "number";

  if (type === "status") {
    status = {
      online: frame.online !== false,
      model: typeof frame.model === "string" ? frame.model : status.model,
      sessionsInUse:
        typeof frame.sessions_in_use === "number" ? frame.sessions_in_use : 0,
      sessionsTotal:
        typeof frame.sessions_total === "number" ? frame.sessions_total : 0,
      updatedAt: Date.now(),
    };
    emit();
    return;
  }

  if (hasCounts) {
    status = {
      ...status,
      online: true,
      model:
        typeof frame.model === "string" && frame.model
          ? frame.model
          : status.model,
      sessionsInUse:
        typeof frame.sessions_in_use === "number"
          ? frame.sessions_in_use
          : status.sessionsInUse,
      sessionsTotal:
        typeof frame.sessions_total === "number"
          ? frame.sessions_total
          : status.sessionsTotal,
      updatedAt: Date.now(),
    };
    emit();
  }
}

/** Push a manual update (e.g. offline detection on socket close). */
export function pushStatus(partial: Partial<AsrStatus>): void {
  status = {
    ...status,
    ...partial,
    updatedAt: Date.now(),
  };
  emit();
}