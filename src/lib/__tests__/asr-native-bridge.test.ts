import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  createAsrSocket,
  tryAcquireStream,
  releaseStream,
  enqueueStreamSlot,
  resetAsrGateForTests,
} from "../asr-gate";


function hasPcmBytes(args: unknown): args is { streamId: string; pcmBytes: unknown } {
  return typeof args === "object" && args !== null && "pcmBytes" in args;
}

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
        pcmBytes: new Uint8Array([10, 20, 30]),
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
  it("binary test: sends PCM as binary Uint8Array IPC payload, not JSON number array (B4)", async () => {
    (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ = {};
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue(undefined);

    const socket = createAsrSocket("ws://127.0.0.1:8765/v1/asr/stream", "me");
    await Promise.resolve();
    expect(socket.readyState).toBe(1); // OPEN

    // Send from ArrayBuffer
    const buf = new Uint8Array([1, 2, 3, 4]).buffer;
    socket.send(buf);

    const sendCall1 = invokeMock.mock.calls.find(
      (c) => c[0] === "asr_native_send" && hasPcmBytes(c[1])
    );
    expect(sendCall1).toBeDefined();
    const rawArg1 = sendCall1?.[1];
    if (!hasPcmBytes(rawArg1)) {
      throw new Error("Expected call arguments to include pcmBytes");
    }
    expect(Array.isArray(rawArg1.pcmBytes)).toBe(false);
    expect(rawArg1.pcmBytes).toBeInstanceOf(Uint8Array);
    expect(rawArg1.pcmBytes).toEqual(new Uint8Array([1, 2, 3, 4]));

    // Send from ArrayBufferView (e.g. Int16Array)
    const view = new Int16Array([100, 200]);
    socket.send(view);

    const sendCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === "asr_native_send" && hasPcmBytes(c[1])
    );
    const sendCall2 = sendCalls[sendCalls.length - 1];
    const rawArg2 = sendCall2?.[1];
    if (!hasPcmBytes(rawArg2)) {
      throw new Error("Expected call arguments to include pcmBytes");
    }
    expect(Array.isArray(rawArg2.pcmBytes)).toBe(false);
    expect(rawArg2.pcmBytes).toBeInstanceOf(Uint8Array);
    expect(rawArg2.pcmBytes).toEqual(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    );
  });

  it("race test: awaits native release before handing off slot to next waiter under mocked IPC latency (B1)", async () => {
    (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ = {};
    const invokeMock = vi.mocked(invoke);

    const events: string[] = [];
    let resolveReleaseIpc!: () => void;
    const releaseIpcPromise = new Promise<void>((resolve) => {
      resolveReleaseIpc = resolve;
    });

    invokeMock.mockImplementation(async (cmd, _args) => {
      events.push(`invoke:${cmd}`);
      if (cmd === "asr_native_release") {
        await releaseIpcPromise;
      }
      return undefined;
    });

    // "them" owns the slot initially
    expect(tryAcquireStream("them")).toBe(true);

    let waiterCalled = false;
    enqueueStreamSlot("me", () => {
      waiterCalled = true;
      events.push("waiter:me:called");
      createAsrSocket("ws://127.0.0.1:8765/v1/asr/stream", "me");
      return true;
    });

    // "them" starts releasing the stream; native release has simulated IPC latency
    const releasePromise = releaseStream("them");

    // Flush immediate microtasks
    await Promise.resolve();

    // Verify: while native release is pending in Rust IPC:
    // 1. Waiter has NOT been invoked yet
    expect(waiterCalled).toBe(false);
    expect(events).toContain("invoke:asr_native_release");
    expect(events).not.toContain("waiter:me:called");
    expect(events).not.toContain("invoke:asr_native_connect");
    // 2. Direct acquisition is rejected while release is in progress
    expect(tryAcquireStream("me")).toBe(false);

    // Now resolve the native release IPC in Rust
    resolveReleaseIpc();
    await releasePromise;
    await Promise.resolve();

    // Verify: ONLY after native release completed, waiter was handed off and connected
    expect(waiterCalled).toBe(true);
    expect(events).toContain("waiter:me:called");
    expect(events).toContain("invoke:asr_native_connect");

    const releaseIdx = events.indexOf("invoke:asr_native_release");
    const waiterIdx = events.indexOf("waiter:me:called");
    const connectIdx = events.indexOf("invoke:asr_native_connect");
    expect(releaseIdx).toBeLessThan(waiterIdx);
    expect(waiterIdx).toBeLessThan(connectIdx);
  });
});
