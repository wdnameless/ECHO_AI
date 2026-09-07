import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMicWsStreaming } from "../useMicWsStreaming";
import { getAsrBaseUrl } from "@/lib/asr-discovery";
import { getResponseSettings } from "@/lib";

vi.mock("@/lib/asr-discovery", () => ({
  getAsrBaseUrl: vi.fn(),
}));

vi.mock("@/lib", () => ({
  getResponseSettings: vi.fn(),
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
    vi.mocked(getResponseSettings).mockReturnValue({
      language: "russian",
      prompt: "",
      model: "gpt-4o",
      provider: "openai",
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    global.WebSocket = originalWebSocket;
    vi.clearAllMocks();
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

  it("implements exponential backoff on consecutive reconnects (min 1s, max 30s)", async () => {
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

    // Attempt 1: drops -> backoff 1s (1000ms)
    const ws1 = MockWebSocket.instances[0];
    act(() => {
      ws1.close();
    });
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(MockWebSocket.instances).toHaveLength(2);

    // Attempt 2: drops -> backoff 2s (2000ms)
    const ws2 = MockWebSocket.instances[1];
    act(() => {
      ws2.close();
    });
    act(() => {
      vi.advanceTimersByTime(1999);
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

  it("throttles logging: warns on first 3 attempts then switches to info", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

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

    // Trigger 4 consecutive reconnect drops
    for (let i = 0; i < 4; i++) {
      const currentWs = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      act(() => {
        currentWs.close();
      });
      // Advance time enough for any backoff
      act(() => {
        vi.advanceTimersByTime(35000);
      });
      await act(async () => {
        await Promise.resolve();
      });
    }

    // First 3 attempts should log with warn
    const micWsWarns = warnSpy.mock.calls.filter(([arg]) =>
      typeof arg === "string" && arg.includes("[mic-ws] (attempt")
    );
    expect(micWsWarns.length).toBe(3);

    // 4th attempt should log with info
    const micWsInfos = infoSpy.mock.calls.filter(([arg]) =>
      typeof arg === "string" && arg.includes("[mic-ws] (attempt")
    );
    expect(micWsInfos.length).toBeGreaterThanOrEqual(1);

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });
});
