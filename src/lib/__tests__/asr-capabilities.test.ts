import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getAsrCapabilities,
  resetAsrCapabilitiesCache,
  noteStreamingUnsupported,
} from "../asr-capabilities";

vi.mock("../asr-discovery", () => ({
  getAsrBaseUrl: vi.fn(async () => "http://127.0.0.1:9877"),
}));

const originalFetch = globalThis.fetch;

function mockHealth(payload: unknown, ok = true): void {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(payload), { status: ok ? 200 : 500 }))
  ) as unknown as typeof globalThis.fetch;
}

describe("asr capabilities", () => {
  beforeEach(() => {
    resetAsrCapabilitiesCache();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports a streaming architecture as streamable", async () => {
    mockHealth({ model: { arch: "nemotron", variant: "nemotron-3.5", supports_streaming: true } });
    await expect(getAsrCapabilities()).resolves.toEqual({
      streaming: true,
      variant: "nemotron-3.5",
    });
  });

  it("trusts the engine's flag: both streamable and batch-only models report arch=parakeet", async () => {
    // Measured on this machine — the architecture cannot distinguish them:
    //   nemotron-3.5-asr-streaming-0.6b  arch=parakeet  supports_streaming=true
    //   parakeet-tdt-0.6b-v3             arch=parakeet  supports_streaming=false
    // An earlier table mapped parakeet -> false, which routed the streaming
    // model through the batch endpoint (2022ms per utterance) even though its
    // socket delivers a first partial in 1.1s and a final 52ms after finalize.
    mockHealth({
      model: {
        arch: "parakeet",
        variant: "nemotron-3.5-asr-streaming-0.6b",
        supports_streaming: true,
      },
    });
    await expect(getAsrCapabilities()).resolves.toEqual({
      streaming: true,
      variant: "nemotron-3.5-asr-streaming-0.6b",
    });

    resetAsrCapabilitiesCache();
    mockHealth({
      model: { arch: "parakeet", variant: "tdt-0.6b-v3", supports_streaming: false },
    });
    await expect(getAsrCapabilities()).resolves.toEqual({
      streaming: false,
      variant: "tdt-0.6b-v3",
    });
  });

  it("keeps a refusal sticky across later health reads", async () => {
    mockHealth({ model: { arch: "parakeet", variant: "v", supports_streaming: true } });
    await expect(getAsrCapabilities()).resolves.toMatchObject({ streaming: true });

    noteStreamingUnsupported();
    // A health re-read (10s TTL) must not resurrect the rejected socket.
    await expect(getAsrCapabilities()).resolves.toMatchObject({ streaming: false });
    await expect(getAsrCapabilities()).resolves.toMatchObject({ streaming: false });

    // ...until the model changes.
    resetAsrCapabilitiesCache();
    await expect(getAsrCapabilities()).resolves.toMatchObject({ streaming: true });
  });

  it("records an actual stream refusal as ground truth", async () => {
    mockHealth({ model: { arch: "nemotron", variant: "nemotron-3.5", supports_streaming: true } });
    await expect(getAsrCapabilities()).resolves.toMatchObject({ streaming: true });

    noteStreamingUnsupported();

    await expect(getAsrCapabilities()).resolves.toMatchObject({
      streaming: false,
      variant: "nemotron-3.5",
    });
  });

  it("falls back to the advertised flag for an unlisted architecture", async () => {
    mockHealth({ model: { arch: "brand-new", variant: "x", supports_streaming: true } });
    await expect(getAsrCapabilities()).resolves.toEqual({ streaming: true, variant: "x" });
  });

  it("assumes batch-only when the engine cannot be reached", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("down"))) as unknown as typeof globalThis.fetch;
    await expect(getAsrCapabilities()).resolves.toEqual({ streaming: false, variant: "" });
  });
});
