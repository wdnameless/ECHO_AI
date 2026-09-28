/**
 * Real-time WebSocket streaming of candidate mic PCM audio to the local ASR sidecar (`/v1/asr/stream`).
 *
 * Responsibility:
 * - Streams raw f32-LE 16 kHz PCM frames from the mic tap directly to pluely-asr.
 * - Manages per-utterance lifecycle (connects on VAD speech start, closes on speech stop).
 * - Dispatches streaming partials for candidate speech with zero 1s batch delay.
 * - Handles auto-reconnection with backoff when connection drops during capture.
 */

import { useCallback, useRef } from "react";
import { getAsrBaseUrl, resetAsrBaseUrlCache } from "@/lib/asr-discovery";
import {
  getAsrCapabilities,
  noteStreamingUnsupported,
} from "@/lib/asr-capabilities";
import { getAsrLanguage } from "@/lib/asr-language";
import { recordWsReconnect, recordLostSegment } from "@/lib/metrics";
import { handleAsrStreamFrame } from "@/lib/asr-stream-frame";
import { releaseStream, tryAcquireStream } from "@/lib/asr-gate";
import {
  nextReconnectDelay,
  closeSocketDetached,
  looksLikeStreamRefusal,
  type ReconnectBackoff,
} from "@/lib/asr-ws-shared";
const MIC_WS_BACKOFF: ReconnectBackoff = { baseMs: 400, maxMs: 3000 };
/**
 * Maximum number of PCM frames buffered while WebSocket is connecting or waiting
 * for stream lock. At 250ms per frame, 24 frames = ~6 seconds of speech preserved.
 */
export const MAX_MIC_BUFFERED_FRAMES = 24;

export interface UseMicWsStreamingProps {
  capturingRef: React.MutableRefObject<boolean>;
  onPartialTranscript: (text: string) => void;
  onFinalTranscript?: (text: string) => void;
}

export function useMicWsStreaming({
  capturingRef,
  onPartialTranscript,
  onFinalTranscript,
}: UseMicWsStreamingProps) {
  const micWsRef = useRef<WebSocket | null>(null);
  const micWsWantRef = useRef(false);
  const micFrameBufferRef = useRef<ArrayBuffer[]>([]);
  const micWsReconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  /** Consecutive refused reconnects, for the backoff. Reset when the socket opens. */
  const micWsReconnectAttemptsRef = useRef(0);
  const micWsStoppedByUsRef = useRef(false);
  const micWsConnectRef = useRef<() => void>(() => {});
  /** True once the open stream answered this utterance with any text. */
  const micProducedTextRef = useRef(false);
  /**
   * Audio frames that actually left over the socket this utterance.
   *
   * Used to tell an engine refusal (audio sent, no text back) from a socket
   * that died before carrying any audio — only the former means the model
   * cannot stream, and only the former may mark streaming unsupported.
   */
  const micFramesSentRef = useRef(0);
  const micUtteranceActiveRef = useRef(false);

  const micWsFinalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Tears the socket down WITHOUT releasing the model.
   *
   * Reopening a stream must not drop the ownership it just took: the release
   * belongs to a deliberate stop, not to a reconnect.
   */
  const micWsCloseSocketOnly = useCallback(() => {
    if (micWsFinalizeTimerRef.current !== null) {
      clearTimeout(micWsFinalizeTimerRef.current);
      micWsFinalizeTimerRef.current = null;
    }
    const ws = micWsRef.current;
    micWsRef.current = null;
    // Shared with the interviewer channel: detach handlers, then close whatever
    // state the socket is in — a handshake finishing in the background would
    // otherwise hold an engine session.
    closeSocketDetached(ws);
  }, []);

  const micWsClose = useCallback(() => {
    releaseStream("me");
    micWsCloseSocketOnly();
  }, [micWsCloseSocketOnly]);

  const micFeedFrame = useCallback((pcm: ArrayBuffer) => {
    const ws = micWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(pcm);
      micFramesSentRef.current += 1;
    } else if (capturingRef.current && micWsWantRef.current) {
      if (micFrameBufferRef.current.length >= MAX_MIC_BUFFERED_FRAMES) {
        micFrameBufferRef.current.shift();
        recordLostSegment();
      }
      micFrameBufferRef.current.push(pcm);
    }
  }, [capturingRef]);

  const scheduleMicWsReconnect = useCallback(() => {
    // Do not reconnect after a deliberate per-utterance close.
    if (micWsStoppedByUsRef.current) {
      micWsStoppedByUsRef.current = false;
      return;
    }
    if (!micWsWantRef.current || !capturingRef.current) return;
    if (micWsReconnectTimerRef.current) return;
    // Back off while the retries fail.
    //
    // The model serves one stream at a time, so this channel's reconnect is
    // refused for as long as the other side holds it. A flat 400ms retry spent
    // that wait hammering the engine — eight refusals inside one utterance, each
    // counted in the UI and each re-paying the base-URL lookup. The delay grows
    // to a second and resets as soon as the socket opens.
    const delay = nextReconnectDelay(
      micWsReconnectAttemptsRef.current,
      MIC_WS_BACKOFF
    );
    micWsReconnectAttemptsRef.current += 1;
    micWsReconnectTimerRef.current = setTimeout(() => {
      micWsReconnectTimerRef.current = null;
      recordWsReconnect();
      micWsConnectRef.current();
    }, delay);
  }, [capturingRef]);
  const micWsConnect = useCallback(() => {
    micWsConnectRef.current = () => {
      void (async () => {
        if (!capturingRef.current) return;
        // Take the model BEFORE tearing down the previous socket. This used to
        // run in the opposite order with a call that releases ownership, so the
        // microphone opened its stream holding nothing: the two channels then
        // raced for the single model, one socket was refused, and the
        // interviewer's audio stopped being transcribed at all.
        if (!tryAcquireStream("me")) {
          scheduleMicWsReconnect();
          return;
        }
        micWsCloseSocketOnly();
        let base: string;
        try {
          base = await getAsrBaseUrl();
        } catch (err) {
          console.warn("[mic-ws]", err);
          base = "";
        }
        if (!capturingRef.current) {
          releaseStream("me");
          return;
        }
        // A model that does not implement `/v1/asr/stream` accepts the socket
        // and then kills it on the first audio frame ("Connection reset without
        // closing handshake" on the engine side, WinError 10053 here). This
        // path used to open that socket unconditionally, so on Parakeet every
        // utterance burned a doomed connection, counted a reconnect and left
        // `micProducedTextRef` false — which surfaced as "the local engine is
        // not responding" while the batch endpoint answered the same audio in
        // ~76ms. The interviewer channel has consulted this flag all along; the
        // microphone never did.
        const caps = await getAsrCapabilities();
        if (!caps.streaming) {
          // Nothing to stream to: hand the slot back and let the caller use the
          // batch path, which is the fast one for these models anyway.
          releaseStream("me");
          return;
        }
        if (!capturingRef.current) {
          releaseStream("me");
          return;
        }
        if (!base) {
          // Release what was just taken. Ownership is a single slot shared with
          // the interviewer channel, and this path held it while opening
          // nothing — so the other side's stream was refused for as long as the
          // retries kept failing, and its reconnect counter climbed instead.
          releaseStream("me");
          scheduleMicWsReconnect();
          return;
        }
        const wsUrl = `${base.replace(/^http/, "ws")}/v1/asr/stream`;
        let ws: WebSocket;
        try {
          ws = new WebSocket(wsUrl);
        } catch (err) {
          console.warn("[mic-ws]", err);
          releaseStream("me");
          scheduleMicWsReconnect();
          return;
        }
        ws.binaryType = "arraybuffer";
        // Track the socket from the moment it exists, not from `onopen`.
        //
        // The interviewer channel was fixed this way and this one was not, so a
        // socket still in CONNECTING was invisible to `micWsCloseSocketOnly`,
        // which walks `micWsRef.current`. Stopping capture during the handshake
        // therefore left the socket alive: it finished connecting in the
        // background, held an engine session, and the pool is three sessions
        // shared with the interviewer channel — the next streams were refused as
        // `model busy` while the app believed it had closed everything.
        micWsRef.current = ws;
        ws.onopen = () => {
          // Recognition language comes from the ASR language setting, never
          // from the answer language: the answer setting defaults to English
          // and used to force Russian speech through an English recogniser.
          ws.send(
            JSON.stringify({ type: "config", language: getAsrLanguage() })
          );
          micWsStoppedByUsRef.current = false;
          // A served connection means the retries were worth it; start the next
          // backoff from the base delay again.
          micWsReconnectAttemptsRef.current = 0;

          // Flush buffered frames queued while socket was connecting or model was locked
          while (micFrameBufferRef.current.length > 0) {
            const buffered = micFrameBufferRef.current.shift();
            if (buffered && ws.readyState === WebSocket.OPEN) {
              ws.send(buffered);
            }
          }
        };
        ws.onmessage = (ev) => {
          // Streaming text from the sidecar: show immediately. Status and
          // latency frames on this socket feed the shared store.
          //
          // `produced` is what lets the caller skip the HTTP batch call for an
          // utterance the stream already transcribed — running both made the
          // second request collect "model busy: a stream is active on this
          // model" on screen.
          if (typeof ev.data === "string" && /"text"\s*:/.test(ev.data)) {
            micProducedTextRef.current = true;
          }
          handleAsrStreamFrame(ev.data, { onPartialTranscript, onFinalTranscript });
        };
        ws.onclose = () => {
          const isCurrent = micWsRef.current === ws;
          if (isCurrent) {
            micWsRef.current = null;
          }
          // A socket that is no longer current must not touch shared state: the
          // slot belongs to its successor, and scheduling a reconnect here would
          // race the socket that just replaced it.
          if (!isCurrent) return;
          // Give the shared slot back. The interviewer channel does this in its
          // own `onclose`; this one did not, so a socket that dropped without a
          // deliberate `micWsClose()` (`micWsFinalizeAndClose` on a socket that
          // was never OPEN, a server-side close, a network drop) left
          // `activeOwner` pinned to "me" for the rest of the session — every
          // system-audio stream was then refused as "model busy" while the
          // microphone itself had nothing open.
          releaseStream("me");
          // A non-streamable model is refused the moment real audio reaches it:
          // measured against parakeet-tdt-0.6b-v3, the engine accepts the
          // handshake, answers a `status` frame, and then aborts the connection
          // on the first audio frame WITHOUT sending any error text — so the
          // textual marker the interviewer channel looks for never arrives.
          // The observable signature of that refusal is therefore: audio was
          // actually sent, and not one partial came back.
          //
          // It must ALSO be an unintentional close. A deliberate per-utterance
          // close (`micWsFinalizeAndClose`) ends the utterance before the model
          // has had time to answer — measured latency is ~1s — so "audio sent,
          // no text yet" is the normal shape of a short utterance. Without this
          // guard, saying one short sentence disabled streaming for the whole
          // application session, for models that support it perfectly well.
          if (
            looksLikeStreamRefusal({
              stoppedByUs: micWsStoppedByUsRef.current,
              framesSent: micFramesSentRef.current,
              producedText: micProducedTextRef.current,
            })
          ) {
            noteStreamingUnsupported();
          }
          scheduleMicWsReconnect();
        };
        ws.onerror = () => {
          // A refused connection means the cached base URL is stale.
          resetAsrBaseUrlCache();
          try {
            ws.close();
          } catch (err) {
            console.warn("[mic-ws]", err);
            // already closing
          }
        };
      })();
    };
    micWsConnectRef.current();
  }, [capturingRef, micWsClose, scheduleMicWsReconnect, onPartialTranscript]);

  const micWsFinalizeAndClose = useCallback(() => {
    micFrameBufferRef.current = [];
    const ws = micWsRef.current;
    micWsStoppedByUsRef.current = true;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "finalize" }));
      } catch (err) {
        console.warn("[mic-ws]", err);
        // connection already dying - fall through to close
      }
      // Free the shared model slot NOW; only the socket close is deferred.
      //
      // The engine releases the model on `finalize` (measured: the same HTTP
      // call that answers `500 model busy` while a stream is open returns 200
      // right after a finalize, with the socket still briefly open). Holding the
      // slot for the full 400ms flush window made the batch path fail:
      // `withNoStream` waits at most 300ms, so the transcription ran while this
      // side still owned the model and the user saw the 500 verbatim.
      releaseStream("me");
      if (micWsFinalizeTimerRef.current !== null) {
        clearTimeout(micWsFinalizeTimerRef.current);
      }
      micWsFinalizeTimerRef.current = setTimeout(() => {
        micWsFinalizeTimerRef.current = null;
        micWsClose();
      }, 400);
    } else {
      micWsClose();
    }
  }, [micWsClose]);

  /** Called at the start of an utterance by the caller's VAD. */
  const micBeginUtterance = useCallback(() => {
    micProducedTextRef.current = false;
    micFramesSentRef.current = 0;
    micUtteranceActiveRef.current = true;
  }, []);

  /** True when the open mic stream already answered this utterance. */
  const micHasProducedText = useCallback(
    () => micProducedTextRef.current,
    []
  );

  const cleanupMicWs = useCallback(() => {
    micWsWantRef.current = false;
    micFrameBufferRef.current = [];
    if (micWsReconnectTimerRef.current) {
      clearTimeout(micWsReconnectTimerRef.current);
      micWsReconnectTimerRef.current = null;
    }
    micWsClose();
  }, [micWsClose]);

  return {
    micWsRef,
    micWsWantRef,
    micWsConnect,
    micWsClose,
    micWsFinalizeAndClose,
    micFeedFrame,
    micBeginUtterance,
    micHasProducedText,
    cleanupMicWs,
  };
}
