/**
 * S2: Deepgram WebSocket streaming implementation.
 *
 * Streams raw 16 kHz 16-bit linear PCM audio to Deepgram's real-time API
 * (`wss://api.deepgram.com/v1/listen`) over WebSocket.
 *
 * Implements:
 * - Real-time interim partial transcripts & final transcripts (R05).
 * - Language parameter passing (T2.2).
 * - Automatic reconnection with exponential backoff on drop (T2.2).
 * - Pre-flight trusted-host check before sending key or audio (R08).
 */

import type {
  StreamingSTTProvider,
  StreamingSTTSession,
  StreamingSTTOptions,
} from "./streaming";
import { isTrustedHost, normalizeHost } from "../trusted-hosts";
import { assertHostTrusted } from "../host-trust-gate";

const DEFAULT_DEEPGRAM_ENDPOINT = "wss://api.deepgram.com/v1/listen";
const MAX_BUFFERED_FRAMES = 24;
const BACKOFF_BASE_MS = 400;
const BACKOFF_MAX_MS = 3000;

function parseDeepgramTranscript(raw: unknown): { transcript: string; isFinal: boolean } | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("channel" in parsed)
  ) {
    return null;
  }

  const channel = parsed.channel;
  if (
    typeof channel !== "object" ||
    channel === null ||
    !("alternatives" in channel) ||
    !Array.isArray(channel.alternatives) ||
    channel.alternatives.length === 0
  ) {
    return null;
  }

  const firstAlt = channel.alternatives[0];
  if (
    typeof firstAlt !== "object" ||
    firstAlt === null ||
    !("transcript" in firstAlt) ||
    typeof firstAlt.transcript !== "string"
  ) {
    return null;
  }

  const text = firstAlt.transcript.trim();
  if (!text) return null;

  const isFinal = "is_final" in parsed && Boolean(parsed.is_final);
  return { transcript: text, isFinal };
}

export class DeepgramStreamingSession implements StreamingSTTSession {
  private ws: WebSocket | null = null;
  private readonly buffer: ArrayBuffer[] = [];
  private reconnectTimer: NodeJS.Timeout | number | null = null;
  private reconnectAttempts = 0;
  private isClosed = false;

  constructor(private readonly opts: StreamingSTTOptions) {
    const targetUrl = this.opts.endpoint || DEFAULT_DEEPGRAM_ENDPOINT;
    if (isTrustedHost(targetUrl)) {
      this.connectSocket(targetUrl);
    } else {
      void this.initUntrusted(targetUrl);
    }
  }

  private async initUntrusted(targetUrl: string): Promise<void> {
    const allowed = await assertHostTrusted(targetUrl, ["apiKey"]);
    if (!allowed || this.isClosed) {
      const host = normalizeHost(targetUrl) || targetUrl;
      this.opts.onError?.(new Error(`Untrusted STT host: ${host}`));
      this.close();
      return;
    }
    this.connectSocket(targetUrl);
  }

  private buildSocketUrl(baseEndpoint: string): string {
    const language = encodeURIComponent(this.opts.language || "en");
    const token = encodeURIComponent(this.opts.apiKey);
    const delimiter = baseEndpoint.includes("?") ? "&" : "?";
    return `${baseEndpoint}${delimiter}encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&language=${language}&token=${token}`;
  }

  private connectSocket(endpoint: string): void {
    if (this.isClosed) return;

    const fullUrl = this.buildSocketUrl(endpoint);
    let socket: WebSocket;
    try {
      socket = new WebSocket(fullUrl, ["token", this.opts.apiKey]);
    } catch (err) {
      if (err instanceof Error) {
        this.opts.onError?.(err);
      }
      this.scheduleReconnect(endpoint);
      return;
    }

    socket.binaryType = "arraybuffer";
    this.ws = socket;

    socket.onopen = () => {
      if (this.isClosed || this.ws !== socket) {
        socket.close();
        return;
      }
      this.reconnectAttempts = 0;
      while (this.buffer.length > 0 && socket.readyState === WebSocket.OPEN) {
        const frame = this.buffer.shift();
        if (frame) {
          try {
            socket.send(frame);
          } catch {
            break;
          }
        }
      }
    };

    socket.onmessage = (event: { data: unknown }) => {
      if (this.isClosed || this.ws !== socket) return;
      const parsed = parseDeepgramTranscript(event.data);
      if (parsed) {
        this.opts.onTranscript(parsed.transcript, parsed.isFinal);
      }
    };

    socket.onerror = (err: unknown) => {
      if (this.isClosed || this.ws !== socket) return;
      if (err instanceof Error) {
        this.opts.onError?.(err);
      }
      try {
        socket.close();
      } catch {
        // already closing
      }
    };

    socket.onclose = () => {
      if (this.ws === socket) {
        this.ws = null;
      }
      if (!this.isClosed) {
        this.scheduleReconnect(endpoint);
      }
    };
  }

  private scheduleReconnect(endpoint: string): void {
    if (this.isClosed || this.reconnectTimer !== null) return;
    const delay = Math.min(
      BACKOFF_BASE_MS * Math.pow(1.5, this.reconnectAttempts),
      BACKOFF_MAX_MS
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isClosed) {
        this.connectSocket(endpoint);
      }
    }, delay);
  }

  send(pcm16: Int16Array): void {
    if (this.isClosed) return;
    const buffer = pcm16.buffer.slice(
      pcm16.byteOffset,
      pcm16.byteOffset + pcm16.byteLength
    );

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(buffer);
      } catch {
        // Socket may have disconnected unexpectedly
      }
    } else {
      if (this.buffer.length >= MAX_BUFFERED_FRAMES) {
        this.buffer.shift();
      }
      this.buffer.push(buffer);
    }
  }

  close(): void {
    this.isClosed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.buffer.length = 0;
    if (this.ws) {
      const active = this.ws;
      this.ws = null;
      try {
        active.close();
      } catch {
        // ignore
      }
    }
  }
}

export class DeepgramStreamingProvider implements StreamingSTTProvider {
  readonly id = "deepgram-stt";

  connect(opts: StreamingSTTOptions): StreamingSTTSession {
    return new DeepgramStreamingSession(opts);
  }
}
