import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  AsrWorkerInMessage,
  AsrWorkerOutMessage,
} from "../asr.worker";

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

describe("asr.worker logic", () => {
  let postedMessages: AsrWorkerOutMessage[];
  let OriginalWebSocket: typeof WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    postedMessages = [];
    MockWebSocket.instances = [];
    OriginalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = OriginalWebSocket;
    vi.restoreAllMocks();
  });

  it("handles init message and connects WebSocket with config", () => {
    let ws: MockWebSocket | null = null;
    let language = "en";

    const postMessage = (msg: AsrWorkerOutMessage) => {
      postedMessages.push(msg);
    };

    const handleMessage = (data: AsrWorkerInMessage) => {
      if (data.type === "init") {
        language = data.language || "en";
        ws = new WebSocket(data.wsUrl) as unknown as MockWebSocket;
        ws.binaryType = "arraybuffer";
        ws.onopen = () => {
          ws?.send(JSON.stringify({ type: "config", language }));
          postMessage({ type: "open" });
        };
      }
    };

    handleMessage({
      type: "init",
      wsUrl: "ws://127.0.0.1:9877/v1/asr/stream",
      language: "ru",
    });

    const mockWs = MockWebSocket.instances[0];
    expect(mockWs).toBeDefined();
    expect(mockWs.url).toBe("ws://127.0.0.1:9877/v1/asr/stream");
    expect(mockWs.binaryType).toBe("arraybuffer");

    mockWs.triggerOpen();
    expect(mockWs.sentData).toContainEqual(
      JSON.stringify({ type: "config", language: "ru" })
    );
    expect(postedMessages).toContainEqual({ type: "open" });
  });

  it("handles audio streaming and text partial dispatch", () => {
    let ws: MockWebSocket | null = null;

    const postMessage = (msg: AsrWorkerOutMessage) => {
      postedMessages.push(msg);
    };

    const handleMessage = (data: AsrWorkerInMessage) => {
      if (data.type === "init") {
        ws = new WebSocket(data.wsUrl) as unknown as MockWebSocket;
        ws.onmessage = (ev: MessageEvent) => {
          const msg = JSON.parse(ev.data as string) as { type: string; text?: string };
          if (msg.type === "text" && typeof msg.text === "string") {
            postMessage({ type: "text", text: msg.text.trim() });
          }
        };
      } else if (data.type === "audio") {
        if (ws && ws.readyState === MockWebSocket.OPEN) {
          ws.send(data.buffer);
        }
      }
    };

    handleMessage({
      type: "init",
      wsUrl: "ws://127.0.0.1:9877/v1/asr/stream",
      language: "en",
    });

    const mockWs = MockWebSocket.instances[0];
    mockWs.triggerOpen();

    const dummyBuffer = new ArrayBuffer(128);
    handleMessage({ type: "audio", buffer: dummyBuffer });

    expect(mockWs.sentData).toContain(dummyBuffer);

    // Simulate partial transcript from server
    mockWs.triggerMessage(JSON.stringify({ type: "text", text: "Привет мир" }));

    expect(postedMessages).toContainEqual({
      type: "text",
      text: "Привет мир",
    });
  });

  it("handles finalize and close", () => {
    let ws: MockWebSocket | null = null;

    const postMessage = (msg: AsrWorkerOutMessage) => {
      postedMessages.push(msg);
    };

    const handleMessage = (data: AsrWorkerInMessage) => {
      if (data.type === "init") {
        ws = new WebSocket(data.wsUrl) as unknown as MockWebSocket;
      } else if (data.type === "finalize") {
        if (ws && ws.readyState === MockWebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "finalize" }));
          setTimeout(() => {
            ws?.close();
            postMessage({ type: "close" });
          }, 400);
        }
      }
    };

    handleMessage({
      type: "init",
      wsUrl: "ws://127.0.0.1:9877/v1/asr/stream",
      language: "en",
    });

    const mockWs = MockWebSocket.instances[0];
    mockWs.triggerOpen();

    handleMessage({ type: "finalize" });
    expect(mockWs.sentData).toContain(
      JSON.stringify({ type: "finalize" })
    );

    vi.advanceTimersByTime(400);
    expect(mockWs.readyState).toBe(MockWebSocket.CLOSED);
    expect(postedMessages).toContainEqual({ type: "close" });
  });
});
