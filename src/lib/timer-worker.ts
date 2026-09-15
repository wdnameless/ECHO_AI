// Unthrottled timer: setTimeout on the main thread is throttled by Chromium
// when the window is hidden/unfocused (down to 1s+ granularity), which
// delays question emission in meeting mode. Timers inside a dedicated
// Worker are exempt from that throttling, so deadlines stay precise even
// when the Echo AI window is in the background.

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, () => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  const code =
    "self.onmessage = (e) => { const { id, delay } = e.data; setTimeout(() => self.postMessage({ id }), delay); };";
  const blob = new Blob([code], { type: "application/javascript" });
  worker = new Worker(URL.createObjectURL(blob));
  worker.onmessage = (e) => {
    const fn = pending.get(e.data?.id);
    pending.delete(e.data?.id);
    fn?.();
  };
  return worker;
}

/**
 * setTimeout that is immune to background-tab throttling.
 * Returns a cancel function.
 */
export function setUnthrottledTimeout(
  fn: () => void,
  delayMs: number
): () => void {
  const w = ensureWorker();
  const id = ++seq;
  pending.set(id, fn);
  w.postMessage({ id, delay: Math.max(0, delayMs) });
  return () => {
    pending.delete(id);
  };
}