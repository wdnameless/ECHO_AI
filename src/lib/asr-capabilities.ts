import { getAsrBaseUrl } from "./asr-discovery";

/**
 * What the loaded recogniser can do.
 *
 * The engine answers this in its `/health` payload: `supports_streaming` says
 * whether the WebSocket protocol (`/v1/asr/stream`) is implemented at all. The
 * fast models are not necessarily streamable — Parakeet TDT answers a stream
 * request with `stream begin failed: not implemented by this model` — and the
 * app must then use the batch path instead of opening a socket that can only
 * fail. Measured on this machine: Parakeet returns an utterance in ~64ms, so
 * the batch path is the FAST one for it; Nemotron streams only slowly (~1.1s
 * per chunk, ~12s for a long buffer).
 */
export interface AsrCapabilities {
  /** True when `/v1/asr/stream` is implemented by the loaded model. */
  streaming: boolean;
  /** Model variant reported by the engine, for logs and the UI. */
  variant: string;
}

const UNKNOWN: AsrCapabilities = { streaming: false, variant: "" };

let cached: { at: number; value: AsrCapabilities } | null = null;
/** Short TTL: a model switch restarts the engine with different capabilities. */
const TTL_MS = 10_000;

/** Reads the engine's capabilities, falling back to "streaming unsupported". */
export async function getAsrCapabilities(): Promise<AsrCapabilities> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const base = await getAsrBaseUrl();
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return UNKNOWN;
    const body = (await res.json()) as {
      model?: { variant?: string; supports_streaming?: boolean };
      supports_streaming?: boolean;
    };
    const value: AsrCapabilities = {
      streaming: Boolean(
        body.model?.supports_streaming ?? body.supports_streaming ?? false
      ),
      variant: body.model?.variant ?? "",
    };
    cached = { at: Date.now(), value };
    return value;
  } catch {
    return UNKNOWN;
  }
}

/** Forgets the cached answer (called when the engine or model changes). */
export function resetAsrCapabilitiesCache(): void {
  cached = null;
}
