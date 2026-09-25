/**
 * Real-time WebSocket streaming of SYSTEM-audio PCM to the local ASR sidecar
 * (`/v1/asr/stream`).
 *
 * The Rust capture emits `speech-frame` (250 ms of fresh 16 kHz f32-LE PCM) as
 * the interviewer speaks, and it had no reader: the only live path re-transcribed
 * the whole utterance once a second through HTTP, so partial text arrived up to a
 * second late and every result repeated what the previous one already said.
 *
 * Responsibility:
 * - Forwards each frame to the sidecar as it arrives (no batching in the app).
 * - Keeps one socket per capture session, reconnecting with backoff.
 * - Feeds inbound frames into the shared ASR status/metrics store.
 */

import { useCallback, useRef } from "react";
import { getAsrBaseUrl, resetAsrBaseUrlCache } from "@/lib/asr-discovery";
import { getAsrLanguage } from "@/lib/asr-language";
import { noteStreamingUnsupported } from "@/lib/asr-capabilities";
import { pushStatus } from "@/lib/asr-status";
import { handleAsrStreamFrame } from "@/lib/asr-stream-frame";
import { releaseStream, tryAcquireStream } from "@/lib/asr-gate";
import { recordWsReconnect } from "@/lib/metrics";

const WS_RECONNECT_MS = 400;

export interface UseThemWsStreamingProps {
  capturingRef: React.MutableRefObject<boolean>;
  onPartialTranscript: (text: string) => void;
  onFinalTranscript?: (text: string) => void;
}

export function useThemWsStreaming({
  capturingRef,
  onPartialTranscript,
  onFinalTranscript,
}: UseThemWsStreamingProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const frameBufferRef = useRef<ArrayBuffer[]>([]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedByUsRef = useRef(false);
  const producedTextRef = useRef(false);
  /**
   * A finalize-driven close asked for a reopen, but no speech has arrived yet.
   * The socket is opened on the next frame instead of immediately, so an idle
   * capture session does not hold an engine session (the pool is finite).
   */
  const pendingReconnectRef = useRef(false);

  const close = useCallback(() => {
    frameBufferRef.current = [];
    pendingReconnectRef.current = false;
    const ws = wsRef.current;
    wsRef.current = null;
    releaseStream("them");
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close();
      } catch {
        // already closing
      }
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!capturingRef.current || stoppedByUsRef.current) return;
    if (reconnectTimerRef.current) return;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      recordWsReconnect();
      void connectRef.current();
    }, WS_RECONNECT_MS);
  }, [capturingRef]);

  /**
   * Reopens after a finalize-driven close, but only when speech is actually
   * arriving.
   *
   * The sidecar closes the socket as soon as it answers a finalize, and the
   * next utterance starts within a second, so a socket was reopened at once to
   * keep the handshake out of the speech. That eager reopen is what exhausted
   * the engine: it grants a fixed number of concurrent sessions (3), holds a
   * session for as long as a socket is open, and the reopened socket sat idle
   * between utterances. After three utterances no stream could be opened at all
   * ("stream begin failed: model busy: a stream is already active on this
   * model", measured with `active_streams: 3` at rest) and recognition stopped
   * for the rest of the session.
   *
   * The connect itself measures ~3ms and frames arriving before it completes
   * are buffered, so waiting for real speech costs nothing measurable.
   */
  const reopenSoon = useCallback(() => {
    if (!capturingRef.current || stoppedByUsRef.current) return;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    pendingReconnectRef.current = true;
  }, [capturingRef]);

  const connectRef = useRef<() => Promise<void>>(async () => {});
  connectRef.current = async () => {
    if (!capturingRef.current) return;

    // One stream at a time: while the candidate's microphone streams, this
    // channel waits instead of collecting "model busy" for every frame.
    if (!tryAcquireStream("them")) {
      scheduleReconnect();
      return;
    }

    let base: string;
    try {
      base = await getAsrBaseUrl();
    } catch {
      base = "";
    }
    if (!base) {
      releaseStream("them");
      scheduleReconnect();
      return;
    }
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${base.replace(/^http/, "ws")}/v1/asr/stream`);
    } catch {
      releaseStream("them");
      scheduleReconnect();
      return;
    }

    ws.binaryType = "arraybuffer";
    // Track the socket from the moment it exists, not from `onopen`.
    //
    // Assigning it only on open left a CONNECTING socket invisible to `close()`,
    // which walks `wsRef.current`: a stream that never finished its handshake
    // held an engine session for the life of the process. With three sessions
    // available this is exactly how recognition stopped — `active_streams` sat
    // at a non-zero value while the app believed it had closed everything.
    wsRef.current = ws;
    ws.onopen = () => {
      // Recognition language comes from the ASR language setting, not from the
      // answer language: the answer setting defaults to English and pinning the
      // recogniser with it transcribed Russian speech as English words.
      ws.send(
        JSON.stringify({ type: "config", language: getAsrLanguage() })
      );
      stoppedByUsRef.current = false;

      while (frameBufferRef.current.length > 0) {
        const buffered = frameBufferRef.current.shift();
        if (buffered && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(buffered);
          } catch (sendErr) {
            // The socket can die between the state check and the send; the
            // remaining buffered frames are dropped with it on close.
            console.debug("[them-ws] buffered frame dropped:", sendErr);
          }
        }
      }
    };
    ws.onmessage = (ev) => {
      const hadText = typeof ev.data === "string" && /"text"\s*:/.test(ev.data);
      if (hadText) producedTextRef.current = true;
      // The engine can refuse the stream even though /health advertised it:
      // remember the refusal so the rest of the session uses the batch path
      // instead of losing every utterance to a socket it will not serve.
      if (
        typeof ev.data === "string" &&
        /not implemented by this model/i.test(ev.data)
      ) {
        noteStreamingUnsupported();
      }
      handleAsrStreamFrame(ev.data, { onPartialTranscript, onFinalTranscript });
    };
    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
        pushStatus({ online: false });
      }
      releaseStream("them");
      // A close we triggered with `finalize` is the protocol working: reopen
      // at once so the handshake never lands inside the next utterance.
      if (stoppedByUsRef.current) {
        stoppedByUsRef.current = false;
        reopenSoon();
        return;
      }
      scheduleReconnect();
    };
    ws.onerror = () => {
      // A refused connection means the cached base URL is stale — the engine
      // rebounds to another port and the renderer must re-resolve it, otherwise
      // every later utterance is streamed into a dead port and never appears.
      resetAsrBaseUrlCache();
      pushStatus({ online: false });
      try {
        ws.close();
      } catch (err) {
        console.warn("[them-ws]", err);
        // already closing
      }
    };
  };

  /** Opens the stream for the current capture session. */
  const start = useCallback(() => {
    stoppedByUsRef.current = false;
    void connectRef.current();
  }, []);

  /** Sends one PCM frame (f32 LE @16 kHz), dropping it if the socket is not up. */
  const feedFrame = useCallback((pcm: ArrayBuffer) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(pcm);
      } catch {
        // socket died between the check and the send
      }
    } else if (capturingRef.current && !stoppedByUsRef.current) {
      if (frameBufferRef.current.length >= 24) {
        frameBufferRef.current.shift();
      }
      frameBufferRef.current.push(pcm);
      // Speech is here, so the socket is worth opening now: a reopen requested
      // by the previous finalize waited for exactly this moment instead of
      // holding an engine session through the silence.
      //
      // Clearing the flag before the (async) connect is what keeps this to one
      // attempt: every later frame in the same window finds it already false,
      // and `connectRef` itself returns while a socket is connecting or open.
      if (pendingReconnectRef.current) {
        pendingReconnectRef.current = false;
        void connectRef.current();
      }
    }
  }, [capturingRef]);

  /**
   * Flushes the current utterance WITHOUT dropping the socket.
   *
   * The sidecar only emits a `final` frame — the one the AI pipeline needs —
   * after a `finalize`, and it then closes the stream itself. That close is the
   * protocol working as designed, so it must not be counted as a connection
   * problem: the counter showed "11 rec" for a healthy session. The next
   * utterance opens a fresh socket from `start()`.
   */
  const finalizeUtterance = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    stoppedByUsRef.current = true;
    try {
      ws.send(JSON.stringify({ type: "finalize" }));
    } catch {
      // connection already dying
    }
  }, []);

  const finalizeAndClose = useCallback(() => {
    stoppedByUsRef.current = true;
    frameBufferRef.current = [];
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "finalize" }));
      } catch {
        // connection already dying
      }
      // Let the server flush its final frame before the socket goes away.
      setTimeout(close, 200);
    } else {
      close();
    }
  }, [close]);

  /** True while the streaming socket is open (it owns the model). */
  const isStreaming = useCallback(
    () => wsRef.current?.readyState === WebSocket.OPEN,
    []
  );

  /** True when the stream already delivered text for the current utterance. */
  const hasProducedText = useCallback(() => producedTextRef.current, []);

  /** Called at the start of an utterance. */
  const beginUtterance = useCallback(() => {
    producedTextRef.current = false;
  }, []);

  return {
    start,
    feedFrame,
    finalizeUtterance,
    finalizeAndClose,
    close,
    isStreaming,
    hasProducedText,
    beginUtterance,
  };
}
