import { invoke } from "@tauri-apps/api/core";

let cachedBase: string | null = null;

/**
 * Resolve the pluely-asr service base URL.
 * Reads the port the sidecar wrote next to its binary (asr-port file),
 * falling back to the default 9877. Result is cached for the session.
 */
export async function getAsrBaseUrl(): Promise<string> {
  if (cachedBase) return cachedBase;

  // Ask the Rust side where the sidecar binary lives (it knows the bundle dir).
  let port = 9877;
  try {
    const raw = await invoke<string | null>("read_asr_port_file");
    if (raw) {
      const parsed = parseInt(raw.trim(), 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        // Probe: is something healthy on that port?
        const ok = await fetch(
          `http://127.0.0.1:${parsed}/health`,
          { signal: AbortSignal.timeout(1500) }
        )
          .then((r) => r.ok)
          .catch(() => false);
        if (ok) {
          cachedBase = `http://127.0.0.1:${parsed}`;
          return cachedBase;
        }
      }
    }
  } catch {
    /* fall through to default */
  }

  cachedBase = `http://127.0.0.1:${port}`;
  return cachedBase;
}

export function resetAsrBaseUrlCache(): void {
  cachedBase = null;
}