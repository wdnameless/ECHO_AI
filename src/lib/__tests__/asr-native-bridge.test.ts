import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  createAsrSocket,
  tryAcquireStream,
  releaseStream,
  getRustStreamOwner,
  resetAsrGateForTests,
} from "../asr-gate";

interface ConnectPayload {
  onEvent?: {
    onmessage?: (msg: string) => void;
  };
}

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: vi.fn().mockResolvedValue(undefined),
    Channel: class MockChannel<T> {
      onmessage: ((msg: T) => void) | null = null;
    },
  };
});

describe("Native ASR bridge (R03 native WS to sidecar)", () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    vi.clearAllMocks();
    resetAsrGateForTests();
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("routes createAsrSocket via Tauri native commands when in Tauri WebView", async () => {
    (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ = {};

    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue(undefined);

    const socket = createAsrSocket("ws://127.0.0.1:8765/v1/asr/stream", "me");
    expect(socket.readyState).toBe(0); // CONNECTING

    expect(invokeMock).toHaveBeenCalledWith(
      "asr_native_connect",
      expect.objectContaining({
        streamId: expect.stringContaining("asr-"),
        url: "ws://127.0.0.1:8765/v1/asr/stream",
        owner: "me",
      })
    );

    const onOpen = vi.fn();
    const onMessage = vi.fn();
    const onClose = vi.fn();
    socket.onopen = onOpen;
    socket.onmessage = onMessage;
    socket.onclose = onClose;

    // Wait for connect promise tick
    await Promise.resolve();
    expect(socket.readyState).toBe(1); // OPEN
    expect(onOpen).toHaveBeenCalledTimes(1);

    // Send config text
    socket.send(JSON.stringify({ type: "config", language: "ru" }));
    expect(invokeMock).toHaveBeenCalledWith(
      "asr_native_send",
      expect.objectContaining({
        text: '{"type":"config","language":"ru"}',
      })
    );

    // Send binary PCM frame
    const pcm = new Uint8Array([10, 20, 30]).buffer;
    socket.send(pcm);
    expect(invokeMock).toHaveBeenCalledWith(
      "asr_native_send",
      expect.objectContaining({
        pcmBytes: [10, 20, 30],
      })
    );

    // Dispatch message through channel
    const connectCall = invokeMock.mock.calls.find((c) => c[0] === "asr_native_connect");
    const callArg = connectCall?.[1];
    let channel: { onmessage?: (msg: string) => void } | undefined;
    if (callArg && typeof callArg === "object" && "onEvent" in callArg) {
      const typed = callArg as ConnectPayload;
      channel = typed.onEvent;
    }
    expect(channel).toBeDefined();

    channel?.onmessage?.('{"type":"partial","text":"привет"}');
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0].data).toBe('{"type":"partial","text":"привет"}');

    // Close socket
    socket.close();
    expect(socket.readyState).toBe(2); // CLOSING
    expect(invokeMock).toHaveBeenCalledWith(
      "asr_native_close",
      expect.objectContaining({
        streamId: expect.any(String),
      })
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(socket.readyState).toBe(3); // CLOSED
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("syncs stream owner acquisitions and releases with Rust in Tauri WebView", async () => {
    (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ = {};
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue(undefined);

    expect(tryAcquireStream("them")).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("asr_native_try_acquire", { owner: "them" });

    releaseStream("them");
    expect(invokeMock).toHaveBeenCalledWith("asr_native_release", { owner: "them" });

    invokeMock.mockResolvedValueOnce("me" as never);
    const owner = await getRustStreamOwner();
    expect(owner).toBe("me");
    expect(invokeMock).toHaveBeenCalledWith("asr_native_get_owner");

    resetAsrGateForTests();
    expect(invokeMock).toHaveBeenCalledWith("asr_native_reset");
  });

  it("falls back to standard WebSocket in non-Tauri browser/test environment", () => {
    const mockWsInstance = {
      readyState: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const MockWs = vi.fn(function (this: unknown) {
      return mockWsInstance;
    });
    global.WebSocket = MockWs as unknown as typeof WebSocket;

    const socket = createAsrSocket("ws://127.0.0.1:8765/v1/asr/stream", "me");
    expect(MockWs).toHaveBeenCalledWith("ws://127.0.0.1:8765/v1/asr/stream");
    expect(socket).toBe(mockWsInstance);
  });
});
