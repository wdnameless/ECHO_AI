import { invoke } from "@tauri-apps/api/core";

/**
 * Resolve the pluely-asr service base URL.
 *
 * Liveness lives in the backend: it probes `/health` on the native engine's
 * ports (the one it recorded, then 9877..9882) and on the legacy python
 * fallback, and reports whichever answers. The renderer asks for that answer
 * instead of guessing — reading the sidecar's `asr-port` file meant trusting a
 * port that nothing had to be serving, and the fallback server (which writes no
 * port file at all) was invisible, which is how transcription ended up posting
 * into a dead port while the app believed recognition was ready.
 *
 * The local probe below remains only as a fallback for environments where the
 * command is unavailable, and mirrors the same order.
 * A short-lived negative cache avoids hammering closed ports on every
 * transcription while the service is still loading the model.
 */
let cachedBase: string | null = null;
let negativeCacheUntil = 0;
const NEGATIVE_CACHE_MS = 3000;
const PROBE_RANGE_END = 9882;

export const ASR_DEFAULT_PORT = 9877;

async function healthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(1200),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Port the backend reports as serving, or null when it cannot tell us. */
async function backendServingPort(): Promise<number | null> {
  try {
    const port = await invoke<number | null>("live_asr_port");
    return typeof port === "number" && port > 0 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

export async function getAsrBaseUrl(): Promise<string> {
  // A cached base is only reused while it still answers. The engine rebounds to
  // the next port when its default is taken (measured: process A on 9877, then
  // 9878), and nothing told the renderer — it kept streaming into the dead port,
  // so speech was captured but never transcribed. One local health probe per
  // connection attempt is cheaper than a silent dead pipeline.
  if (cachedBase) {
    if (await healthy(cachedBase)) return cachedBase;
    cachedBase = null;
  }
  if (Date.now() < negativeCacheUntil) {
    return `http://127.0.0.1:${ASR_DEFAULT_PORT}`;
  }

  const live = await backendServingPort();
  if (live !== null) {
    cachedBase = `http://127.0.0.1:${live}`;
    return cachedBase;
  }

  for (let port = ASR_DEFAULT_PORT; port <= PROBE_RANGE_END; port++) {
    const base = `http://127.0.0.1:${port}`;
    if (await healthy(base)) {
      cachedBase = base;
      return cachedBase;
    }
  }

  negativeCacheUntil = Date.now() + NEGATIVE_CACHE_MS;
  return `http://127.0.0.1:${ASR_DEFAULT_PORT}`;
}

/**
 * Cheap liveness check that does not populate the cache — used by UI
 * indicators. Returns the port when a healthy ASR service is found.
 */
export async function detectAsrPort(): Promise<number | null> {
  const base = await getAsrBaseUrl();
  if (await healthy(base)) {
    // Read the port off the resolved URL without a parser that throws: the
    // string always comes from getAsrBaseUrl, but a null here is cheaper than
    // an exception at a UI indicator.
    const port = Number(/(\d+)$/.exec(base)?.[1]);
    return Number.isFinite(port) && port > 0 ? port : ASR_DEFAULT_PORT;
  }
  return null;
}

export function resetAsrBaseUrlCache(): void {
  cachedBase = null;
  negativeCacheUntil = 0;
}