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
import { getResponseSettings } from "@/lib";
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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedByUsRef = useRef(false);
  const producedTextRef = useRef(false);

  const close = useCallback(() => {
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
    ws.onopen = () => {
      // Same language pin as the mic path, for the same reason: the streaming
      // model must not auto-detect outside the two configured languages.
      const settings = getResponseSettings();
      const lang = settings.language === "russian" ? "ru" : "en";
      ws.send(JSON.stringify({ type: "config", language: lang }));
      wsRef.current = ws;
      stoppedByUsRef.current = false;
    };
    ws.onmessage = (ev) => {
      const hadText = typeof ev.data === "string" && /"text"\s*:/.test(ev.data);
      if (hadText) producedTextRef.current = true;
      handleAsrStreamFrame(ev.data, { onPartialTranscript, onFinalTranscript });
    };
    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
        pushStatus({ online: false });
      }
      releaseStream("them");
      scheduleReconnect();
    };
    ws.onerror = () => {
      // A refused connection means the cached base URL is stale.
      resetAsrBaseUrlCache();
      try {
        ws.close();
      } catch {
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
    }
  }, []);

  /** Asks the server to flush its final text, then closes. */
  const finalizeAndClose = useCallback(() => {
    stoppedByUsRef.current = true;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "finalize" }));
      } catch {
        // connection already dying
      }
      // Let the server flush its final frame before the socket goes away.
      setTimeout(close, 300);
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
    finalizeAndClose,
    close,
    isStreaming,
    hasProducedText,
    beginUtterance,
  };
}
