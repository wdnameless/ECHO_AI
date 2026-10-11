import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMicCapture } from "../useMicCapture";

vi.mock("@ricky0123/vad-web", () => ({ MicVAD: {} }));
vi.mock("onnxruntime-web", () => ({ env: { wasm: {} } }));

const originalMediaDevices = navigator.mediaDevices;
const getUserMedia = vi.fn();
const enumerateDevices = vi.fn();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function microphone(deviceId: string) {
  const track = { readyState: "live", getSettings: () => ({ deviceId }), stop() { this.readyState = "ended"; } };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}
beforeEach(() => {
  getUserMedia.mockReset();
  enumerateDevices.mockReset().mockResolvedValue([]);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia, enumerateDevices }, configurable: true });
});
afterEach(() => {
  Object.defineProperty(navigator, "mediaDevices", { value: originalMediaDevices, configurable: true });
});

it("does not request microphone permission on an idle mount", async () => {
  const { unmount } = renderHook(() => useMicCapture({ onMicSegment: vi.fn() }));
  await act(async () => { await Promise.resolve(); });
  expect(getUserMedia).not.toHaveBeenCalled();
  unmount();
});

it("ends a stream whose permission request resolves after stop", async () => {
  const pending = deferred<MediaStream>();
  const media = microphone("default");
  getUserMedia.mockReturnValue(pending.promise);
  const { result, unmount } = renderHook(() => useMicCapture({ onMicSegment: vi.fn() }));
  await act(async () => { result.current.start(); });
  act(() => { result.current.stop(); });
  await act(async () => { pending.resolve(media.stream); });
  expect(media.track.readyState).toBe("ended");
  expect(result.current.stream).toBeNull();
  unmount();
});

it("releases the active device on stop and acquires a fresh stream on restart", async () => {
  const first = microphone("first");
  const second = microphone("second");
  getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
  const { result, unmount } = renderHook(() => useMicCapture({ onMicSegment: vi.fn() }));
  await act(async () => { result.current.start(); });
  expect(result.current.stream?.getTracks()[0].getSettings().deviceId).toBe("first");
  act(() => { result.current.stop(); });
  expect(first.track.readyState).toBe("ended");
  await act(async () => { result.current.start(); });
  expect(result.current.stream?.getTracks()[0].getSettings().deviceId).toBe("second");
  unmount();
  expect(second.track.readyState).toBe("ended");
});

it("does not ask for permission after stop during device enumeration", async () => {
  const devices = deferred<MediaDeviceInfo[]>();
  enumerateDevices.mockReturnValue(devices.promise);
  const { result, unmount } = renderHook(() => useMicCapture({ microphoneDeviceId: "native-id", microphoneDeviceName: "USB Mic", onMicSegment: vi.fn() }));
  await act(async () => { result.current.start(); });
  act(() => { result.current.stop(); });
  await act(async () => { devices.resolve([]); });
  expect(getUserMedia).not.toHaveBeenCalled();
  unmount();
});

it("resolves a selected native microphone after permission reveals browser device labels", async () => {
  const probe = microphone("default");
  const selected = microphone("browser-usb-mic");
  enumerateDevices.mockResolvedValueOnce([
    { kind: "audioinput", deviceId: "opaque-before-permission", label: "" },
  ]).mockResolvedValueOnce([
    { kind: "audioinput", deviceId: "browser-usb-mic", label: "USB Mic" },
  ]);
  getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
    const audio = constraints.audio as MediaTrackConstraints;
    return (audio.deviceId as { exact?: string } | undefined)?.exact === "browser-usb-mic" ? selected.stream : probe.stream;
  });
  const { result, unmount } = renderHook(() => useMicCapture({ microphoneDeviceId: "wasapi-native-id", microphoneDeviceName: "USB Mic", onMicSegment: vi.fn() }));
  await act(async () => { result.current.start(); });
  expect(result.current.stream?.getTracks()[0].getSettings().deviceId).toBe("browser-usb-mic");
  expect(probe.track.readyState).toBe("ended");
  unmount();
  expect(selected.track.readyState).toBe("ended");
});

it("does not let an old permission result replace a same-render restarted session", async () => {
  const pending = deferred<MediaStream>();
  const old = microphone("old");
  const current = microphone("current");
  getUserMedia.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(current.stream);
  const { result, unmount } = renderHook(() => useMicCapture({ onMicSegment: vi.fn() }));
  await act(async () => { result.current.start(); });
  await act(async () => { result.current.stop(); result.current.start(); });
  await act(async () => { pending.resolve(old.stream); });
  expect(old.track.readyState).toBe("ended");
  expect(result.current.stream?.getTracks()[0].getSettings().deviceId).toBe("current");
  unmount();
});
