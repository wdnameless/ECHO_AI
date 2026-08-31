// Tests for ASR base URL discovery: the pluely-asr sidecar may bind a
// fallback port (9878..9882) when 9877 is busy, so discovery must probe the
// range and honour the asr-port file instead of hardcoding 9877.

import { getAsrBaseUrl, resetAsrBaseUrlCache } from "../asr-discovery";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn() as Mock;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const originalFetch = globalThis.fetch;
beforeEach(() => {
  resetAsrBaseUrlCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  invokeMock.mockReset();
});

function mockHealth(healthyPorts: number[]): void {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const match = url.match(/127\.0\.0\.1:(\d+)\/health/);
    const port = match ? parseInt(match[1], 10) : NaN;
    const ok = match !== null && healthyPorts.includes(port);
    return Promise.resolve(
      new Response(ok ? "{}" : "no", { status: ok ? 200 : 404 })
    );
  }) as unknown as typeof globalThis.fetch;
}

describe("asr discovery", () => {
  it("uses the port file when that port answers /health", async () => {
    invokeMock.mockResolvedValue("9878");
    mockHealth([9878]);
    await expect(getAsrBaseUrl()).resolves.toBe("http://127.0.0.1:9878");
  });

  it("falls back to probing the range when the port file is stale", async () => {
    // Port file claims 9877 (stale) but only 9879 is healthy.
    invokeMock.mockResolvedValue("9877");
    mockHealth([9879]);
    await expect(getAsrBaseUrl()).resolves.toBe("http://127.0.0.1:9879");
  });

  it("returns the default when nothing answers", async () => {
    invokeMock.mockResolvedValue(null);
    mockHealth([]);
    await expect(getAsrBaseUrl()).resolves.toBe("http://127.0.0.1:9877");
  });

  it("caches a healthy result until reset", async () => {
    invokeMock.mockResolvedValue("9879");
    mockHealth([9879]);
    await expect(getAsrBaseUrl()).resolves.toBe("http://127.0.0.1:9879");
    // The sidecar dies and a different port appears: cache still holds.
    mockHealth([9880]);
    invokeMock.mockResolvedValue("9880");
    await expect(getAsrBaseUrl()).resolves.toBe("http://127.0.0.1:9879");
    resetAsrBaseUrlCache();
    await expect(getAsrBaseUrl()).resolves.toBe("http://127.0.0.1:9880");
  });
});