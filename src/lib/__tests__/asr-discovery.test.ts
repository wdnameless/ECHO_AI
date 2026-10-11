import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectAsrPort, getAsrBaseUrl, resetAsrBaseUrlCache } from "../asr-discovery";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
const originalFetch = globalThis.fetch;
beforeEach(() => {
  invokeMock.mockReset();
  resetAsrBaseUrlCache();
  // A foreign listener looks healthy. It must not be probed or adopted.
  globalThis.fetch = vi.fn(async () => new Response('{"status":"ok"}'));
});
afterEach(() => { globalThis.fetch = originalFetch; });

describe("owned ASR discovery", () => {
  it("does not adopt healthy local listeners without a verified backend owner", async () => {
    invokeMock.mockResolvedValue(null);
    expect(await getAsrBaseUrl()).toBe("");
    expect(await detectAsrPort()).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("revokes a previously verified endpoint when ownership disappears", async () => {
    invokeMock.mockResolvedValueOnce(9879).mockResolvedValueOnce(null);
    expect(await getAsrBaseUrl()).toBe("http://127.0.0.1:9879");
    expect(await getAsrBaseUrl()).toBe("");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("follows an owned sidecar restart even if the old listener still answers", async () => {
    invokeMock.mockResolvedValueOnce(9879).mockResolvedValueOnce(9880);
    expect(await getAsrBaseUrl()).toBe("http://127.0.0.1:9879");
    expect(await getAsrBaseUrl()).toBe("http://127.0.0.1:9880");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fails closed when the backend cannot verify ownership", async () => {
    invokeMock.mockRejectedValue(new Error("backend unavailable"));
    expect(await getAsrBaseUrl()).toBe("");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
