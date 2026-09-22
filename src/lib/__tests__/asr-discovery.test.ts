// Tests for ASR base URL discovery.
//
// The port is decided by the backend (`live_asr_port`), which probes /health
// and knows about both the native engine and the legacy python fallback. The
// renderer previously read the sidecar's asr-port file, so a stale file or a
// service that never writes one (the fallback) left it posting into a dead
// port while the app reported recognition as ready.

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
  it("uses the port the backend reports", async () => {
    invokeMock.mockResolvedValue(9880);
    mockHealth([9880]);
    await expect(getAsrBaseUrl()).resolves.toBe("http://127.0.0.1:9880");
    expect(invokeMock).toHaveBeenCalledWith("live_asr_port");
  });

  it("uses a rebound port when the engine moved off the default", async () => {
    // The engine rebounds (9878..9882) when its default port is taken; the
    // renderer must follow the backend's answer rather than assume 9877.
    invokeMock.mockResolvedValue(9881);
    mockHealth([9881]);
    await expect(getAsrBaseUrl()).resolves.toBe("http://127.0.0.1:9881");
  });

  it("probes the range itself when the command is unavailable", async () => {
    // Web preview / older backend: no command, so probe like before.
    invokeMock.mockRejectedValue(new Error("command not found"));
    mockHealth([9879]);
    await expect(getAsrBaseUrl()).resolves.toBe("http://127.0.0.1:9879");
  });

  it("returns the default when nothing answers", async () => {
    invokeMock.mockResolvedValue(null);
    mockHealth([]);
    await expect(getAsrBaseUrl()).resolves.toBe("http://127.0.0.1:9877");
  });

  it("caches a healthy result until reset", async () => {
    invokeMock.mockResolvedValue(9879);
    mockHealth([9879]);
    await expect(getAsrBaseUrl()).resolves.toBe("http://127.0.0.1:9879");
    // The engine restarts on another port: the cache still holds it until reset,
    // which is what a model change does.
    mockHealth([9880]);
    invokeMock.mockResolvedValue(9880);
    await expect(getAsrBaseUrl()).resolves.toBe("http://127.0.0.1:9879");
    resetAsrBaseUrlCache();
    await expect(getAsrBaseUrl()).resolves.toBe("http://127.0.0.1:9880");
  });
});
