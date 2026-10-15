import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/lib/asr-discovery", () => ({
  getAsrBaseUrl: vi.fn(async () => "http://127.0.0.1:9877"),
  resetAsrBaseUrlCache: vi.fn(),
}));
vi.mock("@/lib/asr-language", () => ({ getAsrLanguage: vi.fn(() => "en") }));
vi.mock("@/lib/asr-capabilities", () => ({ noteStreamingUnsupported: vi.fn() }));

vi.mock("@/lib/fast-translator", () => ({
  fastTranslate: vi.fn(async (text: string) => `trans:${text}`),
}));
import { fastTranslate } from "@/lib/fast-translator";
import { useThemWsStreaming } from "../useThemWsStreaming";
import * as asrGate from "@/lib/asr-gate";
import { getAsrBaseUrl } from "@/lib/asr-discovery";
import { noteStreamingUnsupported } from "@/lib/asr-capabilities";

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
    asrGate.resetAsrGateForTests();
    vi.mocked(getAsrBaseUrl).mockResolvedValue("http://127.0.0.1:9877");
  });

  afterEach(() => {
    vi.useRealTimers();
    global.WebSocket = originalWebSocket;
    vi.clearAllMocks();
    vi.restoreAllMocks();
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

  it("recovers when a finalized socket never reports its close", async () => {
    const capturingRef = { current: true };
    const { result } = renderHook(() =>
      useThemWsStreaming({ capturingRef, onPartialTranscript: vi.fn() })
    );

    await act(async () => { result.current.start(); });
    const first = MockWebSocket.instances[0];
    act(() => first.triggerOpen());

    // The utterance ends and the finalize is sent, but the server's close never
    // arrives (refused finalize, stale port). `stoppedByUsRef` is only cleared by
    // that close, so the next utterance's frames were discarded outright and the
    // interviewer's text appeared only from the end-of-speech batch pass —
    // "стало лучше, но я не вижу стриминг текстовый когда собеседник говорит".
    act(() => result.current.finalizeUtterance());
    expect(first.readyState).toBe(MockWebSocket.OPEN);

    await act(async () => { result.current.feedFrame(frame()); });

    expect(MockWebSocket.instances).toHaveLength(2);
    const second = MockWebSocket.instances[1];
    act(() => second.triggerOpen());
    // The frame that arrived while the socket was deaf is delivered, not lost.
    expect(second.sent.some((d) => d instanceof ArrayBuffer)).toBe(true);
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

  it("does not churn the socket while the handshake is still running", async () => {
    const capturingRef = { current: true };
    const { result } = renderHook(() =>
      useThemWsStreaming({ capturingRef, onPartialTranscript: vi.fn() })
    );

    await act(async () => { result.current.start(); });
    const first = MockWebSocket.instances[0];
    // Deliberately NOT opened: the socket sits in CONNECTING while audio pours
    // in at ~33 frames a second. Closing it to "replace" it here would restart
    // the handshake on every frame, so the socket would never finish opening and
    // no live text would ever appear.
    await act(async () => {
      for (let i = 0; i < 20; i++) result.current.feedFrame(frame());
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    act(() => first.triggerOpen());
    // Everything heard during the handshake is delivered, not discarded.
    expect(first.sent.filter((d) => d instanceof ArrayBuffer).length).toBeGreaterThan(0);
  });

  it("frees the shared slot immediately on the mic handoff", async () => {
    // The handoff the microphone triggers must free ownership at once, not when
    // the delayed close finally runs. Ownership is one slot: while this channel
    // held it, the mic's tryAcquireStream("me") was refused and it fell into the
    // reconnect backoff, so the candidate's first words went nowhere. The socket
    // still stays open briefly so the server can flush its final frame.
    const releaseSpy = vi.spyOn(asrGate, "releaseStream");
    releaseSpy.mockClear();

    const capturingRef = { current: true };
    const { result } = renderHook(() =>
      useThemWsStreaming({ capturingRef, onPartialTranscript: vi.fn() })
    );

    await act(async () => { result.current.start(); });
    const first = MockWebSocket.instances[0];
    act(() => first.triggerOpen());

    act(() => result.current.finalizeAndClose());

    // Released synchronously, while the socket itself is still open.
    expect(releaseSpy).toHaveBeenCalledWith("them");
    expect(first.readyState).toBe(MockWebSocket.OPEN);

    // Only after the flush window does the socket actually close.
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(first.readyState).toBe(MockWebSocket.CLOSED);
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
  it("R11 start replaces a finalizing socket without releasing its successor", async () => {
    const { result } = renderHook(() =>
      useThemWsStreaming({ capturingRef: { current: true }, onPartialTranscript: vi.fn() })
    );
    await act(async () => { result.current.start(); });
    const first = MockWebSocket.instances[0];
    act(() => first.triggerOpen());
    const staleClose = first.onclose!;
    act(() => {
      result.current.feedFrame(frame());
      result.current.finalizeAndClose();
    });
    expect(result.current.isStreaming()).toBe(false);
    await act(async () => {
      result.current.beginUtterance();
      result.current.start();
    });
    const next = MockWebSocket.instances[1];
    act(() => {
      next.triggerOpen();
      result.current.feedFrame(frame());
      staleClose(new CloseEvent("close"));
      vi.advanceTimersByTime(1000);
    });
    expect(first.sent.filter((item) => item instanceof ArrayBuffer)).toHaveLength(1);
    expect(next.sent.filter((item) => item instanceof ArrayBuffer)).toHaveLength(1);
    expect(next.readyState).toBe(MockWebSocket.OPEN);
    expect(asrGate.tryAcquireStream("me")).toBe(false);
    expect(noteStreamingUnsupported).not.toHaveBeenCalled();
  });

  it("R11 deliberate finalization remains socket-local after beginUtterance", async () => {
    const { result } = renderHook(() =>
      useThemWsStreaming({ capturingRef: { current: true }, onPartialTranscript: vi.fn() })
    );
    await act(async () => { result.current.start(); });
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.triggerOpen();
      result.current.feedFrame(frame());
      result.current.finalizeUtterance();
      result.current.beginUtterance();
      ws.serverClose();
    });
    expect(noteStreamingUnsupported).not.toHaveBeenCalled();
    expect(asrGate.tryAcquireStream("me")).toBe(true);
  });

  it("R11 handoff invalidates pending interviewer discovery", async () => {
    let resolve!: (url: string) => void;
    vi.mocked(getAsrBaseUrl).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() =>
      useThemWsStreaming({ capturingRef: { current: true }, onPartialTranscript: vi.fn() })
    );
    act(() => result.current.start());
    act(() => result.current.finalizeAndClose());
    expect(asrGate.tryAcquireStream("me")).toBe(true);
    await act(async () => { resolve("http://127.0.0.1:9877"); });
    expect(MockWebSocket.instances).toEqual([]);
    expect(asrGate.tryAcquireStream("them")).toBe(false);
  });

  it("R04 skips base-URL health probe on the second utterance after a served connection", async () => {
    const capturingRef = { current: true };
    const { result } = renderHook(() =>
      useThemWsStreaming({ capturingRef, onPartialTranscript: vi.fn() })
    );

    await act(async () => { result.current.start(); });
    const first = MockWebSocket.instances[0];
    act(() => first.triggerOpen());
    expect(getAsrBaseUrl).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.finalizeUtterance();
      first.serverClose();
    });

    await act(async () => {
      result.current.beginUtterance();
      result.current.start();
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(getAsrBaseUrl).toHaveBeenCalledTimes(1);
  });

  it("R06 closes the socket immediately on a final frame and uses 150ms fallback otherwise", async () => {
    const onFinalTranscript = vi.fn();
    const capturingRef = { current: true };
    const { result } = renderHook(() =>
      useThemWsStreaming({
        capturingRef,
        onPartialTranscript: vi.fn(),
        onFinalTranscript,
      })
    );

    await act(async () => { result.current.start(); });
    const first = MockWebSocket.instances[0];
    act(() => first.triggerOpen());

    act(() => {
      result.current.finalizeAndClose();
    });
    expect(first.readyState).toBe(MockWebSocket.OPEN);

    act(() => {
      first.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "final", text: "Готовый вопрос" }),
        })
      );
    });
    expect(onFinalTranscript).toHaveBeenCalledWith("Готовый вопрос");
    expect(first.readyState).toBe(MockWebSocket.CLOSED);
    expect(asrGate.tryAcquireStream("me")).toBe(true);
    asrGate.releaseStream("me");

    // Fallback path when final frame does not arrive: closes at 150ms
    await act(async () => {
      result.current.beginUtterance();
      result.current.start();
    });
    const second = MockWebSocket.instances[1];
    act(() => second.triggerOpen());
    act(() => result.current.finalizeAndClose());
    expect(second.readyState).toBe(MockWebSocket.OPEN);
    act(() => { vi.advanceTimersByTime(150); });
    expect(second.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("R03 debounces partial translation by 400ms and updates partialTranslation state and callback", async () => {
    const onPartialTranscript = vi.fn();
    const onPartialTranslation = vi.fn();
    const capturingRef = { current: true };
    const { result } = renderHook(() =>
      useThemWsStreaming({
        capturingRef,
        onPartialTranscript,
        onPartialTranslation,
      })
    );

    await act(async () => { result.current.start(); });
    const ws = MockWebSocket.instances[0];
    act(() => ws.triggerOpen());

    // t=0: First partial arrives
    act(() => {
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "text", text: "Привет" }),
        })
      );
    });
    expect(onPartialTranscript).toHaveBeenCalledWith("Привет");
    expect(fastTranslate).not.toHaveBeenCalled();

    // t=200ms: Second partial arrives before 400ms debounce
    act(() => { vi.advanceTimersByTime(200); });
    act(() => {
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "text", text: "Привет мир" }),
        })
      );
    });
    expect(onPartialTranscript).toHaveBeenCalledWith("Привет мир");
    expect(fastTranslate).not.toHaveBeenCalled();

    // Advance another 200ms (t=400ms from start, but only 200ms since last partial): still not called
    act(() => { vi.advanceTimersByTime(200); });
    expect(fastTranslate).not.toHaveBeenCalled();

    // Advance remaining 200ms (t=400ms from last partial): debounce expires, fastTranslate called
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(fastTranslate).toHaveBeenCalledTimes(1);
    expect(fastTranslate).toHaveBeenCalledWith("Привет мир", undefined);
    expect(result.current.partialTranslation).toBe("trans:Привет мир");
    expect(onPartialTranslation).toHaveBeenCalledWith("trans:Привет мир");
  });

  it("R03 cancels pending partial translation debounce on final transcript", async () => {
    const onPartialTranscript = vi.fn();
    const onFinalTranscript = vi.fn();
    const onPartialTranslation = vi.fn();
    const capturingRef = { current: true };
    const { result } = renderHook(() =>
      useThemWsStreaming({
        capturingRef,
        onPartialTranscript,
        onFinalTranscript,
        onPartialTranslation,
      })
    );

    await act(async () => { result.current.start(); });
    const ws = MockWebSocket.instances[0];
    act(() => ws.triggerOpen());

    act(() => {
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "text", text: "Привет" }),
        })
      );
    });
    act(() => { vi.advanceTimersByTime(200); });
    expect(fastTranslate).not.toHaveBeenCalled();

    // Final transcript lands before 400ms debounce fires
    act(() => {
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "final", text: "Привет мир готово" }),
        })
      );
    });
    expect(onFinalTranscript).toHaveBeenCalledWith("Привет мир готово");

    // Advance past debounce: fastTranslate should never have been called
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(fastTranslate).not.toHaveBeenCalled();
    expect(result.current.partialTranslation).toBe("");
  });

  it("R03 cancels pending partial translation debounce on beginUtterance, finalizeUtterance, and close", async () => {
    const capturingRef = { current: true };
    const { result } = renderHook(() =>
      useThemWsStreaming({
        capturingRef,
        onPartialTranscript: vi.fn(),
      })
    );

    await act(async () => { result.current.start(); });
    const ws = MockWebSocket.instances[0];
    act(() => ws.triggerOpen());

    act(() => {
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "text", text: "Часть" }),
        })
      );
    });
    act(() => { vi.advanceTimersByTime(200); });

    // beginUtterance clears debounce
    act(() => result.current.beginUtterance());
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(fastTranslate).not.toHaveBeenCalled();
  });
});
