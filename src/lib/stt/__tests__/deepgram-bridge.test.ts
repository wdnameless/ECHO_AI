import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DeepgramStreamingProvider } from "../deepgram";
import { CloudEmbeddingProvider, EMBEDDING_DIM } from "@/lib/rag/embeddings";
import * as hostTrustGate from "@/lib/host-trust-gate";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: class MockChannel {
    onmessage: ((msg: string) => void) | null = null;
    send(msg: string) {
      this.onmessage?.(msg);
    }
  },
}));

describe("P1-2 & P2: Deepgram WS & Cloud Embedding CSP Bridge", () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("P2: drops apiKey from WebSocket subprotocols (query token only)", () => {
    let capturedProtocols: string | string[] | undefined;
    class ProtocolCheckSocket {
      url: string;
      protocols?: string | string[];
      readyState = 0;
      binaryType = "arraybuffer";
      constructor(url: string, protocols?: string | string[]) {
        this.url = url;
        this.protocols = protocols;
        capturedProtocols = protocols;
      }
      close() {}
    }
    global.WebSocket = ProtocolCheckSocket as unknown as typeof WebSocket;

    const provider = new DeepgramStreamingProvider();
    const session = provider.connect({
      apiKey: "secret-token-xyz",
      language: "en",
      onTranscript: vi.fn(),
    });

    expect(capturedProtocols).toBeUndefined();
    session.close();
  });

  it("P1-2: routes Deepgram WS via Tauri bridge commands when in Tauri WebView", async () => {
    (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ = {};

    const invokeMock = vi.mocked(invoke);
    invokeMock.mockClear();

    const onTranscript = vi.fn();
    const provider = new DeepgramStreamingProvider();
    const session = provider.connect({
      apiKey: "deepgram-token-123",
      language: "es",
      onTranscript,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "stt_stream_connect",
      expect.objectContaining({
        streamId: expect.stringContaining("deepgram-"),
        url: expect.stringContaining("token=deepgram-token-123"),
      })
    );

    const connectCall = invokeMock.mock.calls.find((c) => c[0] === "stt_stream_connect");
    const channel = (connectCall?.[1] as { onEvent?: { onmessage?: (msg: string) => void } })?.onEvent;
    expect(channel).toBeDefined();

    channel?.onmessage?.(
      JSON.stringify({
        channel: {
          alternatives: [{ transcript: "hola mundo" }],
        },
        is_final: true,
      })
    );
    expect(onTranscript).toHaveBeenCalledWith("hola mundo", true);

    const pcm = new Int16Array([10, 20, 30]);
    session.send(pcm);
    expect(invokeMock).toHaveBeenCalledWith(
      "stt_stream_send",
      expect.objectContaining({
        pcmBytes: expect.any(Array),
      })
    );

    session.close();
    expect(invokeMock).toHaveBeenCalledWith(
      "stt_stream_close",
      expect.objectContaining({
        streamId: expect.any(String),
      })
    );
  });

  it("P1-2: routes CloudEmbeddingProvider via @tauri-apps/plugin-http fetch in Tauri", async () => {
    vi.spyOn(hostTrustGate, "assertHostTrusted").mockResolvedValue(true);

    const mockTauriFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: new Array(EMBEDDING_DIM).fill(0.05) }],
      }),
    });

    const provider = new CloudEmbeddingProvider(
      "https://api.openai.com/v1/embeddings",
      "sk-cloud-test",
      "text-embedding-3-small",
      mockTauriFetch as unknown as typeof fetch
    );

    const [vec] = await provider.embed(["bridge test"]);
    expect(vec.length).toBe(EMBEDDING_DIM);
    expect(mockTauriFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-cloud-test",
        }),
      })
    );
  });
});
