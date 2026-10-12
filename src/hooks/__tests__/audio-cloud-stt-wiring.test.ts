import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useThemWsStreaming } from "../useThemWsStreaming";
import * as asrGate from "@/lib/asr-gate";
import * as streaming from "@/lib/stt/streaming";
import { resetAsrGateForTests } from "@/lib/asr-gate";

describe("P1-1 S2 wiring: audio hook cloud STT slot acquisition (R05, R06)", () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    resetAsrGateForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    resetAsrGateForTests();
  });

  it("calls getStreamingProvider and acquireCloudStreamSlot when cloud STT selected", async () => {
    const acquireSpy = vi.spyOn(asrGate, "acquireCloudStreamSlot");
    const getProviderSpy = vi.spyOn(streaming, "getStreamingProvider");

    const mockSession = {
      send: vi.fn(),
      close: vi.fn(),
    };

    const mockProvider: streaming.StreamingSTTProvider = {
      id: "deepgram-stt",
      connect: vi.fn().mockReturnValue(mockSession),
    };

    getProviderSpy.mockReturnValue(mockProvider);

    const capturingRef = { current: true };
    const onPartialTranscript = vi.fn();
    const onFinalTranscript = vi.fn();

    const { result, unmount } = renderHook(() =>
      useThemWsStreaming({
        capturingRef,
        onPartialTranscript,
        onFinalTranscript,
        selectedSttProvider: {
          provider: "deepgram-stt",
          variables: { API_KEY: "cloud-test-key" },
        },
      })
    );

    await act(async () => {
      result.current.start();
    });

    expect(getProviderSpy).toHaveBeenCalledWith("deepgram-stt");
    expect(acquireSpy).toHaveBeenCalledWith("deepgram-stt", mockSession);
    expect(asrGate.getActiveCloudStreamSlot()?.providerId).toBe("deepgram-stt");

    // Feeding an audio frame forwards to the cloud session
    const dummyAudio = new Float32Array([0.1, -0.2, 0.3]).buffer;
    act(() => {
      result.current.feedFrame(dummyAudio);
    });
    expect(mockSession.send).toHaveBeenCalled();

    // Closing the stream releases the cloud stream slot
    act(() => {
      result.current.close();
    });
    expect(asrGate.getActiveCloudStreamSlot()).toBeNull();

    unmount();
  });

  it("keeps local as default path when local STT is selected", async () => {
    const acquireSpy = vi.spyOn(asrGate, "acquireCloudStreamSlot");
    const getProviderSpy = vi.spyOn(streaming, "getStreamingProvider");

    // Local STT returns null from getStreamingProvider
    getProviderSpy.mockReturnValue(null);

    class MockLocalSocket {
      url: string;
      readyState = 1;
      binaryType = "arraybuffer";
      constructor(url: string) {
        this.url = url;
      }
      send() {}
      close() {}
    }
    global.WebSocket = MockLocalSocket as unknown as typeof WebSocket;

    const capturingRef = { current: true };
    const { result, unmount } = renderHook(() =>
      useThemWsStreaming({
        capturingRef,
        onPartialTranscript: vi.fn(),
        onFinalTranscript: vi.fn(),
        selectedSttProvider: {
          provider: "handy-local-whisper",
          variables: {},
        },
      })
    );

    await act(async () => {
      result.current.start();
    });

    expect(acquireSpy).not.toHaveBeenCalled();
    expect(asrGate.getActiveCloudStreamSlot()).toBeNull();

    act(() => {
      result.current.close();
    });
    unmount();
  });
});
