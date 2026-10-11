import { invoke } from "@tauri-apps/api/core";

// Only the backend can verify that our live sidecar owns its listening socket.
// A renderer health response is liveness, not identity, including on a cached port.
let negativeCacheUntil = 0;
const NEGATIVE_CACHE_MS = 3000;

export async function getAsrBaseUrl(): Promise<string> {
  if (Date.now() < negativeCacheUntil) return "";
  try {
    const port = await invoke<number | null>("live_asr_port");
    if (typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535) {
      return `http://127.0.0.1:${port}`;
    }
  } catch {
    // No verified owner: fail closed, never probe or fall back to a fixed port.
  }
  negativeCacheUntil = Date.now() + NEGATIVE_CACHE_MS;
  return "";
}

export async function detectAsrPort(): Promise<number | null> {
  const base = await getAsrBaseUrl();
  return base ? Number(base.slice(base.lastIndexOf(":") + 1)) : null;
}

export function resetAsrBaseUrlCache(): void {
  negativeCacheUntil = 0;
}
