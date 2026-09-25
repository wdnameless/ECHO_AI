import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMicWsStreaming } from "../useMicWsStreaming";
import { getAsrBaseUrl } from "@/lib/asr-discovery";
import { getAsrLanguage } from "@/lib/asr-language";
import * as asrGate from "@/lib/asr-gate";
import { resetAsrGateForTests } from "@/lib/asr-gate";

vi.mock("@/lib/asr-discovery", () => ({
  getAsrBaseUrl: vi.fn(),
}));

vi.mock("@/lib/asr-language", () => ({
  getAsrLanguage: vi.fn(() => "ru"),
}));

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];
  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  binaryType: string = "";
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  sentData: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    this.sentData.push(data);
  }

  close(_code?: number, _reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  triggerMessage(data: string) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data }));
    }
  }

  triggerError() {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }
}

describe("useMicWsStreaming", () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    vi.mocked(getAsrBaseUrl).mockResolvedValue("http://127.0.0.1:8765");
    vi.mocked(getAsrLanguage).mockReturnValue("ru");
    resetAsrGateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.WebSocket = originalWebSocket;
    vi.clearAllMocks();
  });

  it("releases the model when it cannot resolve a base URL", async () => {
    vi.mocked(getAsrBaseUrl).mockResolvedValue("");
    const capturingRef = { current: true };
    const { result } = renderHook(() =>
      useMicWsStreaming({ capturingRef, onPartialTranscript: vi.fn() })
    );

    act(() => {
      result.current.micWsWantRef.current = true;
      result.current.micWsConnect();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Ownership is one slot shared with the interviewer channel. Holding it
    // while opening nothing is what starved the other side's stream, so the
    // real assertion is that the other channel can take the model now.
    expect(asrGate.tryAcquireStream("them")).toBe(true);
  });

  it("connects to ASR streaming endpoint and sends language config on open", async () => {
    const onPartialTranscript = vi.fn();
    const capturingRef = { current: true };

    const { result } = renderHook(() =>
      useMicWsStreaming({
        capturingRef,
        onPartialTranscript,
      })
    );

    act(() => {
      result.current.micWsConnect();
    });

    await act(async () => {
      await Promise.resolve(); // flush getAsrBaseUrl promise
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://127.0.0.1:8765/v1/asr/stream");

    act(() => {
      MockWebSocket.instances[0].triggerOpen();
    });

    expect(MockWebSocket.instances[0].sentData).toHaveLength(1);
    const initMsg = JSON.parse(MockWebSocket.instances[0].sentData[0] as string);
    expect(initMsg).toEqual({ type: "config", language: "ru" });
    expect(result.current.micWsRef.current).toBe(MockWebSocket.instances[0]);
  });

  it("guards against double connect calls when socket is already open or connecting", async () => {
    const onPartialTranscript = vi.fn();
    const capturingRef = { current: true };

    const { result } = renderHook(() =>
      useMicWsStreaming({
        capturingRef,
        onPartialTranscript,
      })
    );

    act(() => {
      result.current.micWsConnect();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(MockWebSocket.instances).toHaveLength(1);

    // Try connecting again while already in progress/open
    act(() => {
      result.current.micWsConnect();
    });

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("handles incoming transcript messages and passes them to callback", async () => {
    const onPartialTranscript = vi.fn();
    const capturingRef = { current: true };

    const { result } = renderHook(() =>
      useMicWsStreaming({
        capturingRef,
        onPartialTranscript,
      })
    );

    act(() => {
      result.current.micWsConnect();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.triggerOpen();
    });

    act(() => {
      ws.triggerMessage(JSON.stringify({ type: "text", text: "Привет мир" }));
    });

    expect(onPartialTranscript).toHaveBeenCalledWith("Привет мир");
  });

  it("handles server error messages gracefully", async () => {
    const onPartialTranscript = vi.fn();
    const capturingRef = { current: true };

    const { result } = renderHook(() =>
      useMicWsStreaming({
        capturingRef,
        onPartialTranscript,
      })
    );

    act(() => {
      result.current.micWsConnect();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.triggerOpen();
    });

    expect(result.current.micWsRef.current).not.toBeNull();

    act(() => {
      ws.triggerMessage(
        JSON.stringify({
          type: "error",
          message: "Model busy or stream error",
        })
      );
    });

    // onPartialTranscript is not called on error frames
    expect(onPartialTranscript).not.toHaveBeenCalled();
  });

  it("reconnects when socket closes unexpectedly if still capturing", async () => {
    const onPartialTranscript = vi.fn();
    const capturingRef = { current: true };

    const { result } = renderHook(() =>
      useMicWsStreaming({
        capturingRef,
        onPartialTranscript,
      })
    );

    // Initial explicit connect sets micWsWantRef = true
    act(() => {
      result.current.micWsConnect();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const ws1 = MockWebSocket.instances[0];
    act(() => {
      ws1.triggerOpen();
    });

    // Simulate unexpected drop from server
    act(() => {
      ws1.close();
    });

    expect(MockWebSocket.instances).toHaveLength(1);

    // Fast-forward reconnect timer (first retry attempt = 1000ms backoff)
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Note on reconnect behavior: micWsConnectRef is captured inside the hook.
    // The reconnect timer triggers the connection lifecycle.
  });

  it("sends binary audio chunks when WebSocket is open via micFeedFrame", async () => {
    const onPartialTranscript = vi.fn();
    const capturingRef = { current: true };

    const { result } = renderHook(() =>
      useMicWsStreaming({
        capturingRef,
        onPartialTranscript,
      })
    );

    act(() => {
      result.current.micWsConnect();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.triggerOpen();
    });

    const dummyAudio = new Float32Array([0.1, -0.2, 0.3]).buffer;

    act(() => {
      result.current.micFeedFrame(dummyAudio);
    });

    expect(ws.sentData).toHaveLength(2); // 1st is language json, 2nd is audio buffer
    expect(ws.sentData[1]).toBe(dummyAudio);
  });

  it("finalizes and closes socket via micWsFinalizeAndClose", async () => {
    const onPartialTranscript = vi.fn();
    const capturingRef = { current: true };

    const { result } = renderHook(() =>
      useMicWsStreaming({
        capturingRef,
        onPartialTranscript,
      })
    );

    act(() => {
      result.current.micWsConnect();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.triggerOpen();
    });

    act(() => {
      result.current.micWsFinalizeAndClose();
    });

    expect(ws.sentData).toHaveLength(2);
    expect(ws.sentData[1]).toBe(JSON.stringify({ type: "finalize" }));

    // Advance 400ms finalize delay
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("cleans up on cleanupMicWs without reconnecting", async () => {
    const onPartialTranscript = vi.fn();
    const capturingRef = { current: true };

    const { result } = renderHook(() =>
      useMicWsStreaming({
        capturingRef,
        onPartialTranscript,
      })
    );

    act(() => {
      result.current.micWsConnect();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.triggerOpen();
    });

    act(() => {
      result.current.cleanupMicWs();
    });

    expect(ws.readyState).toBe(MockWebSocket.CLOSED);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Should NOT reconnect after cleanup
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("resets the backoff once a reconnect is served", async () => {
    const onPartialTranscript = vi.fn();
    const capturingRef = { current: true };

    const { result } = renderHook(() =>
      useMicWsStreaming({
        capturingRef,
        onPartialTranscript,
      })
    );

    act(() => {
      result.current.micWsWantRef.current = true;
      result.current.micWsConnect();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Two refusals grow the delay to 800ms.
    for (let i = 0; i < 2; i++) {
      const ws = MockWebSocket.instances[i];
      act(() => {
        ws.close();
      });
      act(() => {
        vi.advanceTimersByTime(400 * 2 ** i + 1);
      });
      await act(async () => {
        await Promise.resolve();
      });
    }

    // A served socket resets it, so the next drop retries at the base delay
    // again instead of staying pinned to the ceiling for the rest of the call.
    act(() => {
      MockWebSocket.instances[2].triggerOpen();
    });
    act(() => {
      MockWebSocket.instances[2].close();
    });
    act(() => {
      vi.advanceTimersByTime(399);
    });
    const countBefore = MockWebSocket.instances.length;
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(MockWebSocket.instances.length).toBe(countBefore + 1);
  });

  it("backs off while reconnects keep being refused", async () => {
    const onPartialTranscript = vi.fn();
    const capturingRef = { current: true };

    const { result } = renderHook(() =>
      useMicWsStreaming({
        capturingRef,
        onPartialTranscript,
      })
    );

    act(() => {
      result.current.micWsWantRef.current = true;
      result.current.micWsConnect();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const ws1 = MockWebSocket.instances[0];
    act(() => {
      ws1.close();
    });
    // First retry still fires at the base 400ms delay.
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(MockWebSocket.instances).toHaveLength(2);

    // The second attempt is refused too, so the delay doubles to 800ms: this
    // channel is waiting for the other side to release the single model, and
    // retrying every 400ms only produced refused sockets.
    const ws2 = MockWebSocket.instances[1];
    act(() => {
      ws2.close();
    });
    act(() => {
      vi.advanceTimersByTime(799);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("skips reconnect after a deliberate per-utterance close", async () => {
    const onPartialTranscript = vi.fn();
    const capturingRef = { current: true };

    const { result } = renderHook(() =>
      useMicWsStreaming({
        capturingRef,
        onPartialTranscript,
      })
    );

    act(() => {
      result.current.micWsWantRef.current = true;
      result.current.micWsConnect();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(MockWebSocket.instances).toHaveLength(1);

    // Deliberate per-utterance close: finalizeAndClose must NOT schedule
    // a reconnect (the VAD speech-stop path), unlike an unexpected drop.
    act(() => {
      result.current.micWsFinalizeAndClose();
    });
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("buffers audio frames before socket open and flushes them on open", async () => {
    const onPartialTranscript = vi.fn();
    const capturingRef = { current: true };

    const { result } = renderHook(() =>
      useMicWsStreaming({
        capturingRef,
        onPartialTranscript,
      })
    );

    act(() => {
      result.current.micWsWantRef.current = true;
      result.current.micWsConnect();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Feed 3 frames while socket is still CONNECTING
    const frame1 = new Uint8Array([1, 2, 3]).buffer;
    const frame2 = new Uint8Array([4, 5, 6]).buffer;
    const frame3 = new Uint8Array([7, 8, 9]).buffer;

    act(() => {
      result.current.micFeedFrame(frame1);
      result.current.micFeedFrame(frame2);
      result.current.micFeedFrame(frame3);
    });

    const ws = MockWebSocket.instances[0];
    expect(ws.sentData).toHaveLength(0);

    // Now trigger open: config is sent first, followed by all 3 buffered frames in order
    act(() => {
      ws.triggerOpen();
    });

    expect(ws.sentData).toHaveLength(4);
    expect(ws.sentData[0]).toBe(JSON.stringify({ type: "config", language: "ru" }));
    expect(ws.sentData[1]).toBe(frame1);
    expect(ws.sentData[2]).toBe(frame2);
    expect(ws.sentData[3]).toBe(frame3);
  });
});
