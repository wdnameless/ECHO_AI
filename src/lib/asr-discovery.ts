import { invoke } from "@tauri-apps/api/core";

/**
 * Resolve the pluely-asr service base URL.
 *
 * The sidecar binds 9877 by default but falls back to 9878..9882 when the
 * default port is busy (stale instance, another app). It also writes the
 * actually-bound port next to its binary (asr-port file). Discovery order:
 *   1. port file (read via the Rust command) — probed for /health,
 *   2. sequential probe of the 9877..9882 range,
 * falling back to the hardcoded default 9877 only if nothing answers.
 * A short-lived negative cache avoids hammering closed ports on every
 * transcription while the sidecar is still loading the model.
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

export async function getAsrBaseUrl(): Promise<string> {
  if (cachedBase) return cachedBase;
  if (Date.now() < negativeCacheUntil) {
    return `http://127.0.0.1:${ASR_DEFAULT_PORT}`;
  }

  // Ask the Rust side where the sidecar binary lives — it may report the
  // port file even for an already-running rebound instance.
  const candidates: number[] = [];
  try {
    const raw = await invoke<string | null>("read_asr_port_file");
    const parsed = raw ? parseInt(String(raw).trim(), 10) : NaN;
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 65535) {
      candidates.push(parsed);
    }
  } catch {
    /* ignore - probe the range below */
  }
  for (let port = ASR_DEFAULT_PORT; port <= PROBE_RANGE_END; port++) {
    if (!candidates.includes(port)) candidates.push(port);
  }

  for (const port of candidates) {
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
    const port = new URL(base).port;
    return port ? parseInt(port, 10) : ASR_DEFAULT_PORT;
  }
  return null;
}

export function resetAsrBaseUrlCache(): void {
  cachedBase = null;
  negativeCacheUntil = 0;
}