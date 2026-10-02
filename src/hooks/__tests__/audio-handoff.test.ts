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
