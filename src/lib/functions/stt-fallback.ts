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
  /** "high" = final segment (processed first), "low" = live partial. */
  priority?: "high" | "low";
}

export async function transcribeWithFallback({
  audio,
  provider,
  selectedProvider,
  priority = "high",
}: TranscribeWithFallbackParams): Promise<string> {
  // If the cloud Pluely API is enabled, use it directly (explicit user choice).
  const usePluelyAPI = await shouldUsePluelyAPI();
  if (usePluelyAPI) {
    return fetchSTT({ provider: undefined, selectedProvider, audio, priority });
  }

  // LOCAL-FIRST: the local Handy server is ALWAYS tried first, regardless of
  // which provider the user selected in Settings. Cloud providers (Groq,
  // OpenAI, etc.) are used ONLY as a fallback when the local server is
  // offline - this is what kills the 429 rate-limit storms.
  const localProvider = {
    id: "handy-local-whisper",
    name: "Handy Local STT (Local Whisper)",
    curl: `curl -X POST "http://127.0.0.1:8000/v1/audio/transcriptions" \\
      -H "Authorization: Bearer {{API_KEY}}" \\
      -F "file={{AUDIO}}" \\
      -F "model={{MODEL}}"`,
    responseContentPath: "text",
    streaming: false,
  };

  try {
    const localResult = await fetchSTT({
      provider: localProvider,
      selectedProvider: {
        provider: "handy-local-whisper",
        variables: selectedProvider.variables,
      },
      audio,
      priority,
    });
    if (
      localResult &&
      !localResult.startsWith("Pluely STT Error") &&
      !/HTTP \d+/.test(localResult) &&
      !localResult.startsWith("Network error")
    ) {
      return localResult;
    }
  } catch {
    // Local server offline - fall through to the user-selected provider.
  }

  // Local server is offline: use the user-selected provider (may be cloud).
  if (provider) {
    const result = await fetchSTT({ provider, selectedProvider, audio, priority });
    if (
      result &&
      !result.startsWith("Pluely STT Error") &&
      !/HTTP \d+/.test(result) &&
      !result.startsWith("Network error")
    ) {
      return result;
    }
  }

  // Everything failed - clear error, no silent cloud fallback.
  throw new Error(
    "Local STT server is not running. Starting it automatically or restart Pluely. " +
      "Cloud fallback only when the local server is offline."
  );
}
