import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DeepgramStreamingProvider } from "../deepgram";
import { isTrustedHost } from "../../trusted-hosts";
import { setHostTrustPrompt, resetHostTrustPromptForTests } from "../../host-trust-gate";
import { STORAGE_KEYS } from "@/config/constants";
import { SPEECH_TO_TEXT_PROVIDERS } from "@/config/stt.constants";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  url: string;
  protocols?: string | string[];
  readyState: number = 0;
  sentData: (string | ArrayBuffer | ArrayBufferView)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }

  simulateError(err = new Error("WS error")) {
    this.onerror?.(err);
  }

  simulateClose(code = 1000, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  send(data: string | ArrayBuffer | ArrayBufferView) {
    this.sentData.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: "Normal closure" });
  }
}

describe("T2.2 & R05: Deepgram WS streaming implementation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    localStorage.removeItem(STORAGE_KEYS.TRUSTED_HOSTS);
    resetHostTrustPromptForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetHostTrustPromptForTests();
  });

  it("R05: streams audio and passes partial transcripts into feed", () => {
    const provider = new DeepgramStreamingProvider();
    const onTranscript = vi.fn();

    const session = provider.connect({
      apiKey: "test-deepgram-key",
      language: "en",
      onTranscript,
    });

    expect(MockWebSocket.instances.length).toBe(1);
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toContain("wss://api.deepgram.com/v1/listen");
    expect(ws.url).toContain("interim_results=true");
    expect(ws.url).toContain("language=en");

    // Open socket
    ws.simulateOpen();

    // Send audio PCM16
    const pcm = new Int16Array([100, 200, -100, -200]);
    session.send(pcm);
    expect(ws.sentData.length).toBe(1);

    // Deepgram sends interim partial transcript
    ws.simulateMessage({
      type: "Results",
      channel: {
        alternatives: [{ transcript: "hello" }],
      },
      is_final: false,
    });
    expect(onTranscript).toHaveBeenCalledWith("hello", false);

    // Deepgram sends final transcript
    ws.simulateMessage({
      type: "Results",
      channel: {
        alternatives: [{ transcript: "hello world" }],
      },
      is_final: true,
    });
    expect(onTranscript).toHaveBeenCalledWith("hello world", true);

    session.close();
    expect(ws.readyState).toBe(3);
  });

  it("T2.2: sets language parameter correctly", () => {
    const provider = new DeepgramStreamingProvider();
    const session = provider.connect({
      apiKey: "test-key",
      language: "ru",
      onTranscript: vi.fn(),
    });

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toContain("language=ru");
    session.close();
  });

  it("T2.2: reconnects with backoff on unexpected drop until closed", () => {
    const provider = new DeepgramStreamingProvider();
    const session = provider.connect({
      apiKey: "test-key",
      language: "en",
      onTranscript: vi.fn(),
    });

    const ws1 = MockWebSocket.instances[0];
    ws1.simulateOpen();

    // Unexpected close
    ws1.simulateClose(1006, "Abnormal closure");

    // Reconnect timer is scheduled with backoff (e.g. 400ms base)
    expect(MockWebSocket.instances.length).toBe(1);
    vi.advanceTimersByTime(450);

    expect(MockWebSocket.instances.length).toBe(2);
    const ws2 = MockWebSocket.instances[1];
    ws2.simulateOpen();

    // Closing session stops any further reconnect
    session.close();
    ws2.simulateClose(1000, "Clean close");
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it("buffers audio frames while connecting and flushes on open", () => {
    const provider = new DeepgramStreamingProvider();
    const session = provider.connect({
      apiKey: "test-key",
      language: "en",
      onTranscript: vi.fn(),
    });

    const ws = MockWebSocket.instances[0];
    const pcm = new Int16Array([1, 2, 3]);
    session.send(pcm);
    expect(ws.sentData.length).toBe(0);

    ws.simulateOpen();
    expect(ws.sentData.length).toBe(1);
    session.close();
  });
});

describe("T2.3 & R08: trusted-host gate for STT endpoints", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.TRUSTED_HOSTS);
    resetHostTrustPromptForTests();
  });

  afterEach(() => {
    resetHostTrustPromptForTests();
  });

  it("R08: api.deepgram.com is trusted statically before first byte with key", () => {
    expect(isTrustedHost("wss://api.deepgram.com/v1/listen")).toBe(true);
    expect(isTrustedHost("https://api.deepgram.com/v1/listen")).toBe(true);
  });

  it("R08: unknown custom endpoint prompts for confirmation or refuses", async () => {
    const customEndpoint = "wss://custom-stt.example.com/v1/listen";
    expect(isTrustedHost(customEndpoint)).toBe(false);

    let prompted = false;
    let reportedSecrets: string[] = [];
    setHostTrustPrompt(async (request) => {
      prompted = true;
      reportedSecrets = request.secrets;
      return "deny";
    });

    const provider = new DeepgramStreamingProvider();
    const onError = vi.fn();
    const session = provider.connect({
      apiKey: "secret-key-123",
      language: "en",
      endpoint: customEndpoint,
      onTranscript: vi.fn(),
      onError,
    });

    // When denied by user, socket is not created or closed with error
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(prompted).toBe(true);
    expect(reportedSecrets).toContain("apiKey");
    expect(onError).toHaveBeenCalled();
    session.close();
  });

  it("R08: unknown custom endpoint connects when trusted by user", async () => {
    const customEndpoint = "wss://custom-stt.example.com/v1/listen";
    setHostTrustPrompt(async () => "trust");

    const provider = new DeepgramStreamingProvider();
    const session = provider.connect({
      apiKey: "secret-key-123",
      language: "en",
      endpoint: customEndpoint,
      onTranscript: vi.fn(),
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(isTrustedHost(customEndpoint)).toBe(true);
    session.close();
  });
});

describe("T2.3 & R07: stt.constants and fresh install defaults", () => {
  it("R07 & T2.3: stt.constants has deepgram-stt entry with streaming: true", () => {
    const deepgramEntry = SPEECH_TO_TEXT_PROVIDERS.find((p) => p.id === "deepgram-stt");
    expect(deepgramEntry).toBeDefined();
    expect(deepgramEntry?.streaming).toBe(true);
  });

  it("R07: Nemotron local ASR remains default in provider list", () => {
    const defaultEntry = SPEECH_TO_TEXT_PROVIDERS[0];
    expect(defaultEntry.id).toBe("handy-local-whisper");
    expect(defaultEntry.name).toContain("Nemotron");
  });
});
