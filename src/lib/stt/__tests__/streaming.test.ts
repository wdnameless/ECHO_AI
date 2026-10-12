import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getStreamingProvider,
  registerStreamingProvider,
  unregisterStreamingProvider,
  resetStreamingProvidersForTests,
  type StreamingSTTProvider,
  type StreamingSTTSession,
} from "../streaming";
import {
  acquireCloudStreamSlot,
  releaseCloudStreamSlot,
  getActiveCloudStreamSlot,
  resetAsrGateForTests,
} from "../../asr-gate";

describe("T2.1: StreamingSTTProvider interface and registry (R06)", () => {
  beforeEach(() => {
    resetStreamingProvidersForTests();
    resetAsrGateForTests();
  });

  it("resolves built-in deepgram provider by id", () => {
    const provider = getStreamingProvider("deepgram-stt");
    expect(provider).not.toBeNull();
    expect(provider?.id).toBe("deepgram-stt");

    const alias = getStreamingProvider("deepgram");
    expect(alias).not.toBeNull();
    expect(alias?.id).toBe("deepgram-stt");
  });

  it("returns null for unknown provider", () => {
    expect(getStreamingProvider("unknown-provider")).toBeNull();
  });

  it("allows registering and resolving a second provider via interface (R06)", () => {
    const mockSession: StreamingSTTSession = {
      send: vi.fn(),
      close: vi.fn(),
    };
    const secondProvider: StreamingSTTProvider = {
      id: "second-provider",
      connect: vi.fn(() => mockSession),
    };

    registerStreamingProvider(secondProvider);
    const resolved = getStreamingProvider("second-provider");
    expect(resolved).toBe(secondProvider);

    const onTranscript = vi.fn();
    const session = resolved?.connect({
      apiKey: "test-key",
      language: "en",
      onTranscript,
    });
    expect(session).toBe(mockSession);
    expect(secondProvider.connect).toHaveBeenCalledWith({
      apiKey: "test-key",
      language: "en",
      onTranscript,
    });
  });

  it("supports unregistering custom providers", () => {
    const customProvider: StreamingSTTProvider = {
      id: "custom-mock",
      connect: vi.fn(),
    };
    registerStreamingProvider(customProvider);
    expect(getStreamingProvider("custom-mock")).toBe(customProvider);

    unregisterStreamingProvider("custom-mock");
    expect(getStreamingProvider("custom-mock")).toBeNull();
  });
});

describe("T2.1: asr-gate cloud stream seam alongside local WS", () => {
  beforeEach(() => {
    resetAsrGateForTests();
  });

  it("acquires and releases cloud stream slot", () => {
    const mockSession: StreamingSTTSession = {
      send: vi.fn(),
      close: vi.fn(),
    };

    expect(getActiveCloudStreamSlot()).toBeNull();
    const acquired = acquireCloudStreamSlot("deepgram-stt", mockSession);
    expect(acquired).toBe(true);

    const active = getActiveCloudStreamSlot();
    expect(active).not.toBeNull();
    expect(active?.providerId).toBe("deepgram-stt");
    expect(active?.session).toBe(mockSession);

    // Second acquire is rejected while slot is held
    const secondSession: StreamingSTTSession = { send: vi.fn(), close: vi.fn() };
    expect(acquireCloudStreamSlot("second-provider", secondSession)).toBe(false);

    releaseCloudStreamSlot();
    expect(getActiveCloudStreamSlot()).toBeNull();
    expect(mockSession.close).toHaveBeenCalled();
  });

  it("clears cloud stream slot on resetAsrGateForTests", () => {
    const mockSession: StreamingSTTSession = {
      send: vi.fn(),
      close: vi.fn(),
    };
    acquireCloudStreamSlot("deepgram-stt", mockSession);
    expect(getActiveCloudStreamSlot()).not.toBeNull();

    resetAsrGateForTests();
    expect(getActiveCloudStreamSlot()).toBeNull();
  });
});
