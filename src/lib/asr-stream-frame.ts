import { pushFrame } from "./asr-status";

/**
 * Dispatching of one inbound frame from the pluely-asr streaming socket.
 *
 * Both channels (candidate mic, system audio) speak the same protocol and had
 * their own copy of the parse-and-switch; the frame shape lives here instead so a
 * change to the sidecar protocol is a change in one place.
 */

export interface AsrStreamHandlers {
  /** Live partial text for the current utterance. */
  onPartialTranscript: (text: string) => void;
  /** End of an utterance; falls back to `onPartialTranscript` when absent. */
  onFinalTranscript?: (text: string) => void;
}

export function handleAsrStreamFrame(
  raw: unknown,
  handlers: AsrStreamHandlers
): void {
  if (typeof raw !== "string") return;

  let frame: Record<string, unknown>;
  try {
    frame = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return; // malformed frame: ignore
  }

  // Status and latency counters travel on the same socket as the text.
  pushFrame(frame);

  const text = typeof frame.text === "string" ? frame.text.trim() : "";
  if (!text) {
    if (frame.type === "error" && typeof frame.message === "string") {
      console.warn("[asr-stream] server error:", frame.message);
    }
    return;
  }

  if (frame.type === "final") {
    (handlers.onFinalTranscript ?? handlers.onPartialTranscript)(text);
  } else if (frame.type === "text") {
    handlers.onPartialTranscript(text);
  }
}
