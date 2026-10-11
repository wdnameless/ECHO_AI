import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSystemAudioCapture } from "../useSystemAudioCapture";
import { releaseStream, resetAsrGateForTests, tryAcquireStream } from "@/lib/asr-gate";
import { transcribeWithFallback } from "@/lib/functions";

const listeners = vi.hoisted(() => new Map<string, Set<(event: { payload: unknown }) => void>>());
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    const callbacks = listeners.get(name) ?? new Set();
    callbacks.add(callback);
    listeners.set(name, callbacks);
    return () => { callbacks.delete(callback); };
  }),
}));
vi.mock("@/lib", () => ({ safeLocalStorage: { getItem: () => null, setItem: vi.fn() } }));
vi.mock("@/lib/vocab", () => ({ buildInitialPrompt: () => "" }));
vi.mock("@/lib/functions", () => ({
  transcribeWithFallback: vi.fn(async () => "complete interviewer question including tail"),
  isSttErrorMessage: () => false,
}));
vi.mock("@/lib/asr-discovery", () => ({
  getAsrBaseUrl: vi.fn(async () => "http://127.0.0.1:9877"),
  resetAsrBaseUrlCache: vi.fn(),
}));
vi.mock("@/lib/asr-capabilities", () => ({
  getAsrCapabilities: vi.fn(async () => ({ streaming: true })),
  noteStreamingUnsupported: vi.fn(),
}));
vi.mock("@/lib/asr-language", () => ({ getAsrLanguage: () => "en" }));

class Socket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = Socket.CONNECTING;
  binaryType = "";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: unknown[] = [];
  constructor() { Socket.instances.push(this); }
  send(data: unknown) { this.sent.push(data); }
  close() { this.readyState = Socket.CLOSED; this.onclose?.(); }
}

const originalWebSocket = global.WebSocket;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  listeners.clear();
  Socket.instances = [];
  global.WebSocket = Socket as unknown as typeof WebSocket;
  resetAsrGateForTests();
});
afterEach(() => {
  vi.useRealTimers();
  global.WebSocket = originalWebSocket;
  resetAsrGateForTests();
});

it.each(["finalizing", "closed"])("R11 retains full WAV during %s interviewer mic handoff", async (state) => {
  const props = {
    selectedAudioDevices: { input: { id: "test", name: "test" }, output: { id: "test", name: "test" } },
    selectedSttProvider: { provider: "test", variables: {} },
    appendLiveSegment: vi.fn(),
    onInterviewerTranscription: vi.fn(async () => {}),
    setMyLastTranscription: vi.fn(),
    setTheirLastTranscription: vi.fn(),
    setIsAIProcessing: vi.fn(),
    setError: vi.fn(),
  };
  const { result } = renderHook(() => useSystemAudioCapture(props));
  await act(async () => { result.current.setCapturing(true); });
  await act(async () => { listeners.get("speech-start")!.forEach((callback) => callback({ payload: null })); });
  const interviewer = Socket.instances[0];
  act(() => {
    interviewer.readyState = Socket.OPEN;
    interviewer.onopen?.();
    interviewer.onmessage?.({ data: '{"type":"partial","text":"opening words"}' });
    result.current.yieldThemToMic();
  });
  expect(tryAcquireStream("me")).toBe(true);
  expect(result.current.themIsStreaming()).toBe(false);
  if (state === "closed") await act(async () => { vi.advanceTimersByTime(250); });

  const wav = new Uint8Array(52);
  const view = new DataView(wav.buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) {
    for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i);
  }
  view.setUint32(4, 44, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, 8, true);
  new Int16Array(wav.buffer, 44).set([1000, 2000, 3000, 4000]);
  const payload = btoa(String.fromCharCode(...wav));
  await act(async () => {
    listeners.get("speech-frame")!.forEach((callback) => callback({ payload: btoa("pcm-tail") }));
    listeners.get("speech-detected")!.forEach((callback) => callback({ payload }));
    vi.advanceTimersByTime(1000);
  });
  expect(transcribeWithFallback).not.toHaveBeenCalled();
  expect(Socket.instances).toEqual([interviewer]);
  expect(tryAcquireStream("them")).toBe(false);
  await act(async () => {
    releaseStream("me");
    result.current.releaseMicModelOwnership();
  });
  expect(props.setError).not.toHaveBeenCalledWith(expect.stringContaining("busy"));
  expect(props.onInterviewerTranscription).toHaveBeenCalledExactlyOnceWith("complete interviewer question including tail", 0);
  const audio = vi.mocked(transcribeWithFallback).mock.calls[0][0].audio as Blob;
  vi.useRealTimers();
  // ES2020 project lib has no Promise.withResolvers; FileReader works in jsdom.
  const actual = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(audio);
  });
  expect(new Uint8Array(actual)).toEqual(wav);
});

function captureProps() {
  return {
    selectedAudioDevices: { input: { id: "test", name: "test" }, output: { id: "test", name: "test" } },
    selectedSttProvider: { provider: "test", variables: {} },
    appendLiveSegment: vi.fn(),
    onInterviewerTranscription: vi.fn(async (_text: string, _pauseBeforeMs?: number) => {}),
    setMyLastTranscription: vi.fn(),
    setTheirLastTranscription: vi.fn(),
    setIsAIProcessing: vi.fn(),
    setError: vi.fn(),
  };
}

it("dispatches the previous clause before resumed speech clears its buffer", async () => {
  const props = captureProps();
  const { result, unmount } = renderHook(() => useSystemAudioCapture(props));
  const emit = (name: string) => listeners.get(name)!.forEach((callback) => callback({ payload: "" }));
  await act(async () => { result.current.setCapturing(true); });
  await act(async () => { emit("speech-start"); });
  act(() => {
    const socket = Socket.instances[0];
    socket.readyState = Socket.OPEN;
    socket.onopen?.();
    socket.onmessage?.({ data: '{"type":"final","text":"Первая часть вопроса"}' });
    emit("speech-detected");
  });
  await act(async () => { emit("speech-start"); });
  expect(props.onInterviewerTranscription).toHaveBeenCalledExactlyOnceWith("Первая часть вопроса");
  act(() => {
    const socket = Socket.instances[1];
    socket.readyState = Socket.OPEN;
    socket.onopen?.();
    emit("speech-detected");
    socket.onmessage?.({ data: '{"type":"final","text":"Вторая часть вопроса"}' });
    vi.advanceTimersByTime(1500);
  });
  expect(props.onInterviewerTranscription.mock.calls.map((call) => call[0])).toEqual([
    "Первая часть вопроса", "Вторая часть вопроса",
  ]);
  unmount();
});

it.each(["stop", "restart", "unmount"])("ignores delayed batch results after capture %s", async (transition) => {
  let resolveTranscript!: (text: string) => void;
  vi.mocked(transcribeWithFallback).mockImplementationOnce(
    () => new Promise<string>((resolve) => { resolveTranscript = resolve; })
  );
  const props = captureProps();
  const { result, unmount } = renderHook(() => useSystemAudioCapture(props));
  await act(async () => { result.current.setCapturing(true); });
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.transcribeSegment(new Blob(["synthetic audio"]), "them"); });
  if (transition === "unmount") {
    unmount();
  } else {
    act(() => {
      result.current.setCapturing(false);
      if (transition === "restart") result.current.setCapturing(true);
    });
  }
  await act(async () => {
    resolveTranscript("Реплика прежней сессии");
    await pending;
  });
  expect(props.setTheirLastTranscription).not.toHaveBeenCalled();
  expect(props.appendLiveSegment).not.toHaveBeenCalled();
  expect(props.onInterviewerTranscription).not.toHaveBeenCalled();
  if (transition !== "unmount") unmount();
});

it("does not publish final stream frames from a stopped capture", async () => {
  const props = captureProps();
  const { result, unmount } = renderHook(() => useSystemAudioCapture(props));
  await act(async () => { result.current.setCapturing(true); });
  await act(async () => {
    listeners.get("speech-start")!.forEach((callback) => callback({ payload: "" }));
  });
  const socket = Socket.instances[0];
  act(() => {
    socket.readyState = Socket.OPEN;
    socket.onopen?.();
    result.current.setCapturing(false);
    socket.onmessage?.({ data: '{"type":"final","text":"Запоздавший результат"}' });
    vi.advanceTimersByTime(1500);
  });
  expect(props.appendLiveSegment).not.toHaveBeenCalled();
  expect(props.onInterviewerTranscription).not.toHaveBeenCalled();
  unmount();
});

it("mic release during ongoing interviewer speech resumes fresh socket and forwards later frames", async () => {
  const props = captureProps();
  const { result, unmount } = renderHook(() => useSystemAudioCapture(props));
  await act(async () => { result.current.setCapturing(true); });

  act(() => { result.current.yieldThemToMic(); });
  expect(tryAcquireStream("me")).toBe(true);

  await act(async () => {
    listeners.get("speech-start")!.forEach((callback) => callback({ payload: "" }));
  });
  expect(Socket.instances).toHaveLength(0);

  await act(async () => {
    releaseStream("me");
    result.current.releaseMicModelOwnership();
  });

  expect(Socket.instances).toHaveLength(1);
  const interviewerSocket = Socket.instances[0];

  act(() => {
    listeners.get("speech-frame")!.forEach((callback) => callback({ payload: btoa("pcm-tail") }));
  });
  act(() => {
    interviewerSocket.readyState = Socket.OPEN;
    interviewerSocket.onopen?.();
  });
  expect(interviewerSocket.sent.some((item) => item instanceof ArrayBuffer)).toBe(true);

  act(() => {
    listeners.get("speech-detected")!.forEach((callback) => callback({ payload: btoa("RIFF...") }));
  });
  expect(interviewerSocket.sent.some((item) => typeof item === "string" && item.includes("finalize"))).toBe(true);
  unmount();
});

it("mic release in silence after interviewer speech finished does not reopen socket", async () => {
  const props = captureProps();
  const { result, unmount } = renderHook(() => useSystemAudioCapture(props));
  await act(async () => { result.current.setCapturing(true); });

  act(() => { result.current.yieldThemToMic(); });
  await act(async () => {
    listeners.get("speech-start")!.forEach((callback) => callback({ payload: "" }));
  });
  expect(Socket.instances).toHaveLength(0);

  await act(async () => {
    listeners.get("speech-detected")!.forEach((callback) => callback({ payload: btoa("RIFF...") }));
  });
  expect(Socket.instances).toHaveLength(0);

  await act(async () => {
    releaseStream("me");
    result.current.releaseMicModelOwnership();
  });

  expect(Socket.instances).toHaveLength(0);
  unmount();
});

it("mic release after capture stopped does not reopen socket", async () => {
  const props = captureProps();
  const { result, unmount } = renderHook(() => useSystemAudioCapture(props));
  await act(async () => { result.current.setCapturing(true); });

  act(() => { result.current.yieldThemToMic(); });
  await act(async () => {
    listeners.get("speech-start")!.forEach((callback) => callback({ payload: "" }));
  });

  act(() => { result.current.setCapturing(false); });
  await act(async () => {
    releaseStream("me");
    result.current.releaseMicModelOwnership();
  });

  expect(Socket.instances).toHaveLength(0);
  unmount();
});
