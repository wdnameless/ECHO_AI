/**
 * Primitives shared by the two ASR streaming channels.
 *
 * The microphone channel (`useMicWsStreaming`) and the interviewer channel
 * (`useThemWsStreaming`) speak the same protocol to the same engine, but they
 * are separate hooks — and every bug in this class came from fixing one and
 * forgetting the other:
 *
 * - the socket ref was assigned at creation in one and in `onopen` in the other,
 *   so a CONNECTING socket could not be closed and leaked an engine session;
 * - exponential reconnect backoff existed in one and the other retried flat;
 * - the frames-sent counter that distinguishes "the model refused the stream"
 *   from "the socket carried nothing" existed in one only.
 *
 * These are the small, stable pieces those fixes touched. They live here so the
 * next change applies to both channels by construction. The hooks themselves
 * stay separate: their lifecycle differs enough (a finalize timer and utterance
 * gate on one side, a reopen-after-finalize dance and close timer on the other)
 * that merging them would need an options bag as large as the code it replaces —
 * a shallow module, not a deep one.
 */

/** Base delay and ceiling for a channel's reconnect backoff. */
export interface ReconnectBackoff {
  baseMs: number;
  maxMs: number;
}

/**
 * Delay before the next reconnect attempt.
 *
 * Exponential, capped: the engine serves ONE stream at a time, so a reconnect is
 * refused for as long as the other channel holds it. A flat retry spent that
 * wait hammering the engine — eight refusals inside one utterance, each counted
 * in the UI and each re-paying the base-URL lookup.
 */
export function nextReconnectDelay(
  attempts: number,
  { baseMs, maxMs }: ReconnectBackoff
): number {
  return Math.min(baseMs * 2 ** attempts, maxMs);
}

/**
 * Detaches handlers and closes a socket, whatever state it is in.
 *
 * Closing while CONNECTING matters: a handshake that finishes in the background
 * after the app believes it stopped holds an engine session, and the pool is
 * three sessions shared by both channels. Detaching the handlers first means the
 * teardown cannot re-enter the reconnect logic.
 */
export function closeSocketDetached(ws: WebSocket | null): void {
  if (!ws) return;
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.onopen = null;
    try {
      ws.close();
    } catch {
      // Already closing: nothing to do.
    }
  }
}

/**
 * Whether a socket close looks like the model refusing to stream.
 *
 * The engine accepts a handshake, answers a `status` frame, then drops the
 * socket on the first audio frame WITHOUT error text — so the textual marker is
 * never sent and the observable signature is "audio was actually sent, and not
 * one partial came back".
 *
 * A DELIBERATE close must never count: a per-utterance finalize ends the
 * utterance at ~0s while the model answers at ~1s, so "audio sent, no text yet"
 * is the normal shape of a short sentence. Without that check, saying one short
 * sentence disabled streaming for the whole session on models that support it.
 */
export function looksLikeStreamRefusal(state: {
  stoppedByUs: boolean;
  framesSent: number;
  producedText: boolean;
}): boolean {
  return (
    !state.stoppedByUs && state.framesSent > 0 && !state.producedText
  );
}
