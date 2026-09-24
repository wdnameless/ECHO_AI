import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getAsrCapabilities, resetAsrCapabilitiesCache } from "../asr-capabilities";

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

  it("reports a streaming model as streamable", async () => {
    mockHealth({ model: { variant: "nemotron-3.5", supports_streaming: true } });
    await expect(getAsrCapabilities()).resolves.toEqual({
      streaming: true,
      variant: "nemotron-3.5",
    });
  });

  it("reports a non-streamable model as batch-only", async () => {
    // Parakeet answers `stream begin failed: not implemented by this model`,
    // so the app must not open a socket for it.
    mockHealth({ model: { variant: "tdt-0.6b-v3", supports_streaming: false } });
    await expect(getAsrCapabilities()).resolves.toEqual({
      streaming: false,
      variant: "tdt-0.6b-v3",
    });
  });

  it("assumes batch-only when the engine cannot be reached", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("down"))) as unknown as typeof globalThis.fetch;
    await expect(getAsrCapabilities()).resolves.toEqual({ streaming: false, variant: "" });
  });
});
