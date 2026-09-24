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

  it("treats a non-streaming architecture as batch-only even when health claims otherwise", async () => {
    // Observed in practice: a Parakeet file reported arch=parakeet together
    // with variant=nemotron-3.5-… and supports_streaming: true. Trusting the
    // flag opened a socket the model refuses and the utterance was lost.
    mockHealth({
      model: { arch: "parakeet", variant: "nemotron-3.5-asr-streaming-0.6b", supports_streaming: true },
    });
    await expect(getAsrCapabilities()).resolves.toEqual({
      streaming: false,
      variant: "nemotron-3.5-asr-streaming-0.6b",
    });
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
