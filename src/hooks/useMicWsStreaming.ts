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
import { getAsrLanguage } from "@/lib/asr-language";
import { recordWsReconnect, recordLostSegment } from "@/lib/metrics";
import { handleAsrStreamFrame } from "@/lib/asr-stream-frame";
import { releaseStream, tryAcquireStream } from "@/lib/asr-gate";
const MIC_WS_RECONNECT_MS = 400;

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
  const micWsStoppedByUsRef = useRef(false);
  const micWsConnectRef = useRef<() => void>(() => {});
  /** True once the open stream answered this utterance with any text. */
  const micProducedTextRef = useRef(false);
  const micUtteranceActiveRef = useRef(false);

  const micWsFinalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const micWsClose = useCallback(() => {
    releaseStream("me");
    if (micWsFinalizeTimerRef.current !== null) {
      clearTimeout(micWsFinalizeTimerRef.current);
      micWsFinalizeTimerRef.current = null;
    }
    const ws = micWsRef.current;
    micWsRef.current = null;
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    }
  }, []);

  const micFeedFrame = useCallback((pcm: ArrayBuffer) => {
    const ws = micWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(pcm);
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
    micWsReconnectTimerRef.current = setTimeout(() => {
      micWsReconnectTimerRef.current = null;
      recordWsReconnect();
      micWsConnectRef.current();
    }, MIC_WS_RECONNECT_MS);
  }, [capturingRef]);
  const micWsConnect = useCallback(() => {
    micWsConnectRef.current = () => {
      void (async () => {
        if (!capturingRef.current) return;
        // The sidecar serves one stream per model: if the system-audio channel
        // owns it, wait rather than being refused.
        if (!tryAcquireStream("me")) {
          scheduleMicWsReconnect();
          return;
        }
        micWsClose();
        let base: string;
        try {
          base = await getAsrBaseUrl();
        } catch (err) {
          console.warn("[mic-ws]", err);
          base = "";
        }
        if (!base) {
          scheduleMicWsReconnect();
          return;
        }
        const wsUrl = `${base.replace(/^http/, "ws")}/v1/asr/stream`;
        let ws: WebSocket;
        try {
          ws = new WebSocket(wsUrl);
        } catch (err) {
          console.warn("[mic-ws]", err);
          scheduleMicWsReconnect();
          return;
        }
        ws.binaryType = "arraybuffer";
        ws.onopen = () => {
          // Recognition language comes from the ASR language setting, never
          // from the answer language: the answer setting defaults to English
          // and used to force Russian speech through an English recogniser.
          ws.send(
            JSON.stringify({ type: "config", language: getAsrLanguage() })
          );
          micWsRef.current = ws;
          micWsStoppedByUsRef.current = false;

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
          if (micWsRef.current === ws) {
            micWsRef.current = null;
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
      // Give the server a moment to flush the 'final' event, then close.
      // Kept in a ref: the user can start the next utterance inside these 400 ms,
      // and an orphaned timer then closed the socket that had just been opened.
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
