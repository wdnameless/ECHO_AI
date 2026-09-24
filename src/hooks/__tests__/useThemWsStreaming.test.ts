import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/lib/asr-discovery", () => ({ getAsrBaseUrl: vi.fn(async () => "http://127.0.0.1:9877") }));
vi.mock("@/lib/asr-language", () => ({ getAsrLanguage: vi.fn(() => "en") }));
vi.mock("@/lib/asr-gate", () => ({
  tryAcquireStream: vi.fn(() => true),
  releaseStream: vi.fn(),
  withNoStream: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import { useThemWsStreaming } from "../useThemWsStreaming";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  binaryType = "";
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  sent: Array<string | ArrayBuffer> = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(data: string | ArrayBuffer) { this.sent.push(data); }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }
  triggerOpen() { this.readyState = MockWebSocket.OPEN; this.onopen?.(new Event("open")); }
  /** The sidecar closes the socket itself after answering a finalize. */
  serverClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }
}

const frame = () => new ArrayBuffer(1024);

describe("useThemWsStreaming session usage", () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    global.WebSocket = originalWebSocket;
    vi.clearAllMocks();
  });

  /**
   * The engine grants a fixed number of concurrent sessions and holds one for as
   * long as a socket is open. Reopening eagerly after every finalize left an idle
   * socket holding a session, and after three utterances no stream could be
   * opened at all ("stream begin failed: model busy"), so recognition stopped.
   */
  it("does not reopen a socket while no speech is arriving", async () => {
    const capturingRef = { current: true };
    const { result } = renderHook(() =>
      useThemWsStreaming({ capturingRef, onPartialTranscript: vi.fn() })
    );

    await act(async () => { result.current.start(); });
    const first = MockWebSocket.instances[0];
    act(() => first.triggerOpen());
    expect(MockWebSocket.instances).toHaveLength(1);

    // Speech ended: the app finalizes and the server closes the socket.
    act(() => result.current.finalizeUtterance());
    act(() => first.serverClose());
    await act(async () => { vi.advanceTimersByTime(2000); });

    // Silence must not open a new socket: that is what exhausted the pool.
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("reopens on the next audio frame after a finalize-driven close", async () => {
    const capturingRef = { current: true };
    const { result } = renderHook(() =>
      useThemWsStreaming({ capturingRef, onPartialTranscript: vi.fn() })
    );

    await act(async () => { result.current.start(); });
    const first = MockWebSocket.instances[0];
    act(() => first.triggerOpen());

    act(() => result.current.finalizeUtterance());
    act(() => first.serverClose());

    // The next utterance starts: the first frame buys the socket back.
    await act(async () => { result.current.feedFrame(frame()); });

    expect(MockWebSocket.instances).toHaveLength(2);
    const second = MockWebSocket.instances[1];
    act(() => second.triggerOpen());
    // The frame that triggered the reopen is buffered and flushed on open.
    expect(second.sent.some((d) => d instanceof ArrayBuffer)).toBe(true);
  });

  it("keeps one socket through a whole utterance", async () => {
    const capturingRef = { current: true };
    const { result } = renderHook(() =>
      useThemWsStreaming({ capturingRef, onPartialTranscript: vi.fn() })
    );

    await act(async () => { result.current.start(); });
    const ws = MockWebSocket.instances[0];
    act(() => ws.triggerOpen());

    await act(async () => {
      for (let i = 0; i < 8; i++) result.current.feedFrame(frame());
    });

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  /**
   * A socket assigned to the ref only on `open` is invisible to `close()`, which
   * walks the ref: a stream that never finished its handshake held an engine
   * session for the life of the process, and three of those stopped recognition
   * entirely.
   */
  it("closes a socket that never finished connecting", async () => {
    const capturingRef = { current: true };
    const { result } = renderHook(() =>
      useThemWsStreaming({ capturingRef, onPartialTranscript: vi.fn() })
    );

    await act(async () => { result.current.start(); });
    const connecting = MockWebSocket.instances[0];
    expect(connecting.readyState).toBe(MockWebSocket.CONNECTING);

    act(() => result.current.close());

    expect(connecting.readyState).toBe(MockWebSocket.CLOSED);
  });
});
