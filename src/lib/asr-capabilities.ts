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

/**
 * Whether an architecture implements `/v1/asr/stream`.
 *
 * There is deliberately NO table here. An earlier version mapped
 * `parakeet → false`, on the assumption that the architecture decided
 * streaming support. Measured on this machine, both the streamable and the
 * batch-only model report `arch: "parakeet"`:
 *
 *   nemotron-3.5-asr-streaming-0.6b  arch=parakeet  supports_streaming=true
 *   parakeet-tdt-0.6b-v3             arch=parakeet  supports_streaming=false
 *
 * So the architecture cannot distinguish them, and that table permanently
 * routed the streaming model through the batch endpoint — measured 2022ms per
 * utterance against 1.1s to the first partial text over the socket. The flag
 * the engine reports for the model it actually loaded is the accurate source,
 * and an outright refusal (`noteStreamingUnsupported`) outranks it.
 */
let cached: { at: number; value: AsrCapabilities } | null = null;
/** Short TTL: a model switch restarts the engine with different capabilities. */
const TTL_MS = 10_000;
/**
 * Set when the engine refused a stream. Sticky for the session: the refusal is
 * ground truth about the loaded model, and re-reading `/health` would only
 * re-open the same rejected socket. Cleared by a model switch.
 */
let refusedStreaming = false;

/** Reads the engine's capabilities, falling back to "streaming unsupported". */
export async function getAsrCapabilities(): Promise<AsrCapabilities> {
  if (refusedStreaming) {
    return { streaming: false, variant: cached?.value.variant ?? "" };
  }
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const base = await getAsrBaseUrl();
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return UNKNOWN;
    const body = (await res.json()) as {
      model?: { arch?: string; variant?: string; supports_streaming?: boolean };
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
  refusedStreaming = false;
}

/**
 * Records that the engine refused a stream, whatever `/health` claimed.
 *
 * A refusal is ground truth about the loaded model ("stream begin failed: not
 * implemented by this model"), and it outranks the advertised flag for the rest
 * of the session: `/health` is re-read on a 10s TTL, so without a sticky flag
 * the app re-opened the same rejected socket every ten seconds and lost the
 * utterance each time. Cleared when the model changes.
 */
export function noteStreamingUnsupported(): void {
  refusedStreaming = true;
  cached = {
    at: Date.now(),
    value: { streaming: false, variant: cached?.value.variant ?? "" },
  };
}
