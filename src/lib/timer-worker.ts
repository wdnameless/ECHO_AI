// Unthrottled timer: setTimeout on the main thread is throttled by Chromium
// when the window is hidden/unfocused (down to 1s+ granularity), which
// delays question emission in meeting mode. Timers inside a dedicated
// Worker are exempt from that throttling, so deadlines stay precise even
// when the Echo AI window is in the background.

let worker: Worker | null = null;
let workerUnavailable = false;
let seq = 0;
const pending = new Map<number, () => void>();

/**
 * Handle returned by `setTimeout`, as this module is the owner of the value.
 *
 * The DOM and Node typings disagree about the exact type, so the name is
 * declared here rather than leaking an implementation-dependent
 * `ReturnType<typeof setTimeout>` into signatures.
 */
type TimerHandle = number | NodeJS.Timeout;

/** Timer state for the fallback path, when a Worker cannot be created. */
const fallbackTimers = new Map<number, TimerHandle>();

function ensureWorker(): Worker | null {
  if (worker) return worker;
  // Worker may be missing entirely (test environments, hardened WebViews) or
  // blocked by policy. Degrading to a main-thread timer keeps the app working;
  // it only loses the throttling exemption, which is a timing nuance rather
  // than something that should break question emission outright.
  if (workerUnavailable) return null;
  if (typeof Worker === "undefined" || typeof URL?.createObjectURL !== "function") {
    workerUnavailable = true;
    return null;
  }
  try {
    const code =
      "self.onmessage = (e) => { const { id, delay } = e.data; setTimeout(() => self.postMessage({ id }), delay); };";
    const blob = new Blob([code], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const created = new Worker(url);
    created.onmessage = (e) => {
      const fn = pending.get(e.data?.id);
      pending.delete(e.data?.id);
      fn?.();
    };
    worker = created;
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

/**
 * setTimeout that is immune to background-tab throttling.
 * Returns a cancel function.
 *
 * Falls back to a main-thread timer when a Worker is unavailable, so callers
 * have a single contract regardless of the environment.
 */
export function setUnthrottledTimeout(
  fn: () => void,
  delayMs: number
): () => void {
  const delay = Math.max(0, delayMs);
  const w = ensureWorker();

  if (!w) {
    const id = ++seq;
    fallbackTimers.set(
      id,
      setTimeout(() => {
        fallbackTimers.delete(id);
        fn();
      }, delay)
    );
    return () => {
      const handle = fallbackTimers.get(id);
      if (handle !== undefined) {
        clearTimeout(handle);
        fallbackTimers.delete(id);
      }
    };
  }

  const id = ++seq;
  pending.set(id, fn);
  w.postMessage({ id, delay });
  return () => {
    pending.delete(id);
  };
}

/**
 * Drops the cached worker and pending timers.
 *
 * Only for tests: the module keeps a single worker for the process lifetime,
 * which is correct in the app but makes tests share state between cases.
 */
export function resetTimerWorkerForTests(): void {
  // `terminate` is optional so a partial Worker implementation cannot break the
  // reset itself.
  if (typeof worker?.terminate === "function") {
    worker.terminate();
  }
  worker = null;
  workerUnavailable = false;
  pending.clear();
  for (const handle of fallbackTimers.values()) {
    clearTimeout(handle);
  }
  fallbackTimers.clear();
}