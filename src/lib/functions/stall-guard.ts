/**
 * Racing a promise against a timeout, for reads that may never settle.
 *
 * `reader.cancel()` cannot unblock a stalled read over the Tauri HTTP plugin:
 * the response body is a ReadableStream fed by an IPC channel
 * (`plugin:http|fetch_read_body`), and cancelling the reader does not stop that
 * Rust task — the pending `read()` stays unsettled forever. So a guard built on
 * `cancel()` converts "the gateway went silent" into a permanent spinner, which
 * is the failure it was supposed to fix. Racing is what actually returns
 * control.
 *
 * The window timer is cleared on both outcomes, so a long-lived stream does not
 * accumulate one pending timer per chunk.
 */
export function raceStall<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stall = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("STALL")), timeoutMs);
  });
  return Promise.race([promise, stall]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}
