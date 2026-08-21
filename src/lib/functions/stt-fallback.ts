import { fetchSTT } from "./stt.function";
import { shouldUsePluelyAPI } from "./pluely.api";
import { TYPE_PROVIDER } from "@/types";

/**
 * LOCAL-FIRST STT pipeline.
 *
 * The automatic fallback chain is now 100% local:
 *   1. Handy GPU model (Nemotron 3.5 ASR Streaming, Vulkan) - primary
 *   2. Local openai-whisper (CPU, base.pt cached) - in-process fallback
 *      inside the local server (see scripts/handy_stt_server.py)
 *
 * There is NO automatic Groq/cloud fallback anymore - this is what caused
 * the 429 "Too Many Requests" storms. If the local server is offline the
 * request fails with a clear error; the user can pick a cloud provider
 * manually in Settings if they want to.
 */

export interface TranscribeWithFallbackParams {
  provider?: TYPE_PROVIDER;
  selectedProvider: { provider: string; variables: Record<string, string> };
  audio: Blob | File;
  /** Kept for API compatibility; cloud fallback is no longer automatic. */
  allowCloudFallback?: boolean;
}

export async function transcribeWithFallback({
  audio,
  provider,
  selectedProvider,
}: TranscribeWithFallbackParams): Promise<string> {
  // If the cloud Pluely API is enabled, use it directly (explicit user choice).
  const usePluelyAPI = await shouldUsePluelyAPI();
  if (usePluelyAPI) {
    return fetchSTT({ provider: undefined, selectedProvider, audio });
  }

  // If the user explicitly selected a non-local provider (e.g. Groq, OpenAI),
  // use it directly - that is a deliberate manual choice in Settings.
  if (provider && provider.id !== "handy-local-whisper") {
    return fetchSTT({ provider, selectedProvider, audio });
  }

  // Missing provider: explicit error, never silently hit a cloud API.
  if (!provider) {
    throw new Error(
      "Speech provider config not found. Please configure a provider in Settings."
    );
  }

  // Local Handy path: GPU model first, then the in-server local whisper.
  // The Python server already implements the GPU -> local-CPU fallback chain,
  // so a single request is enough - no cloud involved.
  const result = await fetchSTT({ provider, selectedProvider, audio });
  if (
    result &&
    !result.startsWith("Pluely STT Error") &&
    !/HTTP \d+/.test(result) &&
    !result.startsWith("Network error")
  ) {
    return result;
  }

  // Local server is offline or failed - clear error, no cloud fallback.
  throw new Error(
    "Local STT server is not running. Starting it automatically or restart Pluely. " +
      "Groq cloud fallback has been removed to avoid rate limits."
  );
}
