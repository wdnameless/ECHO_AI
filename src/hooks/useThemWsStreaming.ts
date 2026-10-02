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
import {
  nextReconnectDelay,
  closeSocketDetached,
  looksLikeStreamRefusal,
  type ReconnectBackoff,
} from "@/lib/asr-ws-shared";

const WS_BACKOFF: ReconnectBackoff = { baseMs: 400, maxMs: 3000 };
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
  /** Consecutive failed reconnect attempts, for the exponential backoff. */
  const reconnectAttemptsRef = useRef(0);
  const producedTextRef = useRef(false);
  const socketStateRef = useRef<{
    stoppedByUs: boolean;
    framesSent: number;
    producedText: boolean;
  } | null>(null);
  const wantRef = useRef(false);
  const connectEpochRef = useRef(0);
  const ownerEpochRef = useRef<number | null>(null);

  const releaseOwner = useCallback((epoch = ownerEpochRef.current) => {
    if (epoch === null || ownerEpochRef.current !== epoch) return;
    ownerEpochRef.current = null;
    releaseStream("them");
  }, []);

  const cancelConnect = useCallback(() => {
    connectEpochRef.current += 1;
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);
  /**
   * The delayed close after a finalize, held so the next connection can cancel
   * it. See `finalizeAndClose` for why an unheld timer is dangerous.
   */
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    cancelConnect();
    wantRef.current = false;
    frameBufferRef.current = [];
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    const ws = wsRef.current;
    wsRef.current = null;
    socketStateRef.current = null;
    releaseOwner();
    // Shared with the microphone channel: detach handlers, then close whatever
    // state the socket is in.
    closeSocketDetached(ws);
  }, [cancelConnect, releaseOwner]);

  const scheduleReconnect = useCallback(() => {
    if (!capturingRef.current || !wantRef.current || socketStateRef.current?.stoppedByUs) return;
    if (reconnectTimerRef.current) return;
    // Back off while the retries keep failing (see WS_RECONNECT_MAX_MS). The
    // delay resets on a served connection, below in `onopen`.
    const delay = nextReconnectDelay(reconnectAttemptsRef.current, WS_BACKOFF);
    reconnectAttemptsRef.current += 1;
    const epoch = connectEpochRef.current;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (epoch !== connectEpochRef.current || !wantRef.current || !capturingRef.current) return;
      recordWsReconnect();
      void connectRef.current();
    }, delay);
  }, [capturingRef]);


  const connectRef = useRef<() => Promise<void>>(async () => {});
  connectRef.current = async () => {
    if (!capturingRef.current || !wantRef.current) return;
    if (ownerEpochRef.current !== null ||
        (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN)) return;

    // One stream at a time: while the candidate's microphone streams, this
    // channel waits instead of collecting "model busy" for every frame.
    if (!tryAcquireStream("them")) {
      scheduleReconnect();
      return;
    }
    const epoch = ++connectEpochRef.current;
    ownerEpochRef.current = epoch;

    let base: string;
    try {
      base = await getAsrBaseUrl();
    } catch {
      base = "";
    }
    if (epoch !== connectEpochRef.current) return;
    if (!capturingRef.current || !wantRef.current) {
      releaseOwner(epoch);
      return;
    }
    if (!base) {
      releaseOwner(epoch);
      scheduleReconnect();
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${base.replace(/^http/, "ws")}/v1/asr/stream`);
    } catch {
      releaseOwner(epoch);
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
    const state = { stoppedByUs: false, framesSent: 0, producedText: false };
    socketStateRef.current = state;
    ws.onopen = () => {
      if (wsRef.current !== ws || epoch !== connectEpochRef.current ||
          !capturingRef.current || !wantRef.current) {
        if (wsRef.current === ws) close();
        else closeSocketDetached(ws);
        return;
      }
      // Recognition language comes from the ASR language setting, not from the
      // answer language: the answer setting defaults to English and pinning the
      // recogniser with it transcribed Russian speech as English words.
      ws.send(
        JSON.stringify({ type: "config", language: getAsrLanguage() })
      );
      // A served connection means the retries were worth it: start the next
      // backoff from the base delay again.
      reconnectAttemptsRef.current = 0;

      while (frameBufferRef.current.length > 0) {
        const buffered = frameBufferRef.current.shift();
        if (buffered && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(buffered);
            state.framesSent += 1;
          } catch (sendErr) {
            // The socket can die between the state check and the send; the
            // remaining buffered frames are dropped with it on close.
            console.debug("[them-ws] buffered frame dropped:", sendErr);
          }
        }
      }
    };
    ws.onmessage = (ev) => {
      if (wsRef.current !== ws) return;
      const hadText = typeof ev.data === "string" && /"text"\s*:/.test(ev.data);
      if (hadText) {
        producedTextRef.current = true;
        state.producedText = true;
      }
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
      // Only the CURRENT socket may free the shared slot.
      //
      // `releaseStream("them")` used to run unconditionally, right next to a
      // check that already established whether this socket is current. A stale
      // socket closing later (the one replaced when audio arrived after a
      // finalize) then freed the slot belonging to its successor: two streams
      // raced on one model, the engine answered `500 model busy` for the batch
      // pass, and utterances were lost — exactly what `asr-gate.ts` exists to
      // prevent.
      const isCurrent = wsRef.current === ws;
      if (isCurrent) {
        wsRef.current = null;
        pushStatus({ online: false });
      }
      if (!isCurrent) {
        // The stale socket's own teardown ends here: it must not release the
        // slot and must not schedule a competing reconnect.
        return;
      }
      socketStateRef.current = null;
      releaseOwner(epoch);
      // A model that cannot stream is refused the moment real audio reaches it:
      // the engine accepts the handshake, answers a status frame, and then drops
      // the socket on the first audio frame WITHOUT sending error text — so the
      // textual marker checked in `onmessage` never arrives. The observable
      // signature is audio sent and not one partial returned. Recording it stops
      // the next utterance from paying for the same doomed socket and lets the
      // batch path handle the audio instead. The microphone channel has had this
      // since its own fix; the interviewer channel never did, so on a
      // batch-only model it reopened a socket per utterance forever.
      if (
        looksLikeStreamRefusal({
          stoppedByUs: state.stoppedByUs,
          framesSent: state.framesSent,
          producedText: state.producedText,
        })
      ) {
        noteStreamingUnsupported();
      }
      // Finalized sockets are done; fresh speech, not silence, reopens them.
      if (state.stoppedByUs) return;
      scheduleReconnect();
    };
    ws.onerror = () => {
      if (wsRef.current !== ws) return;
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
    if (socketStateRef.current?.stoppedByUs ||
        (wsRef.current && wsRef.current.readyState > WebSocket.OPEN)) close();
    wantRef.current = true;
    void connectRef.current();
  }, [close]);

  /** Sends one PCM frame (f32 LE @16 kHz), dropping it if the socket is not up. */
  const feedFrame = useCallback((pcm: ArrayBuffer) => {
    if (!wantRef.current) return;
    const ws = wsRef.current;
    // A finalized socket cannot accept audio for the next utterance.
    const belongsToFinishedUtterance = socketStateRef.current?.stoppedByUs;

    if (ws && ws.readyState === WebSocket.OPEN && !belongsToFinishedUtterance) {
      try {
        ws.send(pcm);
        // Refusal detection compares audio and text on this socket only.
        if (socketStateRef.current) socketStateRef.current.framesSent += 1;
      } catch {
        // socket died between the check and the send
      }
      return;
    }

    if (!capturingRef.current) return;

    if (belongsToFinishedUtterance) {
      // Close before buffering: close clears the old utterance's frames.
      if (ws) close();
      wantRef.current = true;

      if (frameBufferRef.current.length >= 24) {
        frameBufferRef.current.shift();
      }
      frameBufferRef.current.push(pcm);
      void connectRef.current();
      return;
    }

    if (ws && ws.readyState === WebSocket.CONNECTING) {
      // The handshake is still running and will flush what is buffered on open.
      // Closing it here would restart the handshake on every frame — frames
      // arrive ~33 times a second, so the socket would never finish opening and
      // no live text would ever appear.
    } else if (!ws) {
      void connectRef.current();
    }

    if (frameBufferRef.current.length >= 24) {
      frameBufferRef.current.shift();
    }
    frameBufferRef.current.push(pcm);
  }, [capturingRef, close]);

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
    if (!ws || ws.readyState !== WebSocket.OPEN || socketStateRef.current?.stoppedByUs) return;
    cancelConnect();
    if (socketStateRef.current) socketStateRef.current.stoppedByUs = true;
    try {
      ws.send(JSON.stringify({ type: "finalize" }));
    } catch {
      // connection already dying
    }
    // The engine releases the model on `finalize`, not on the socket closing.
    //
    // Measured against the running sidecar: with a stream open, an HTTP
    // transcription answers `500 transcription failed: model busy: a stream is
    // active on this model`; send `finalize` and the same call returns 200 while
    // the socket is still briefly open. Holding our slot until `onclose` therefore
    // made the HTTP path fail for the whole close window — `withNoStream` only
    // waits 300ms, while the socket stayed open past that, and the user saw the
    // 500 verbatim.
    releaseOwner();
  }, [cancelConnect, releaseOwner]);

  const finalizeAndClose = useCallback(() => {
    cancelConnect();
    wantRef.current = false;
    if (socketStateRef.current) socketStateRef.current.stoppedByUs = true;
    frameBufferRef.current = [];
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "finalize" }));
      } catch {
        // connection already dying
      }
      // Give the shared slot back NOW, and only defer the socket close.
      //
      // This is the handoff the microphone triggers (`yieldThemToMic`), and the
      // very next line of that path calls `micWsConnect()`. Ownership is a
      // single slot, so while this channel still held it the mic's
      // `tryAcquireStream("me")` was refused and it fell into the reconnect
      // backoff — the candidate's first words were streamed into a socket that
      // did not exist yet. The socket itself stays open for the 200ms the server
      // needs to flush its `final`; the slot, which is what the other channel
      // competes for, is released immediately.
      releaseOwner();
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        if (wsRef.current === ws) close();
      }, 200);
    } else {
      close();
    }
  }, [cancelConnect, close, releaseOwner]);

  /** True while the streaming socket is open (it owns the model). */
  const isStreaming = useCallback(
    () => wsRef.current?.readyState === WebSocket.OPEN &&
      !socketStateRef.current?.stoppedByUs && ownerEpochRef.current !== null,
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
