import { fetchSTT } from "./stt.function";
import { shouldUsePluelyAPI } from "./pluely.api";
import { TYPE_PROVIDER } from "@/types";
import { safeLocalStorage } from "@/lib/storage/helper";

export const GROQ_FALLBACK_STORAGE_KEY = "stt_fallback_groq_key";

export interface TranscribeWithFallbackParams {
  provider?: TYPE_PROVIDER;
  selectedProvider: { provider: string; variables: Record<string, string> };
  audio: Blob | File;
  /**
   * When false (default), if the primary provider is the local Handy server
   * and it fails, the request FAILS instead of falling back to Groq.
   * Used for high-frequency live partial streaming: falling back to a
   * cloud API on every ~1s chunk burns quota and hits 429 rate limits.
   */
  allowCloudFallback?: boolean;
}

/**
 * Tries the user-selected STT provider first. If it fails (e.g. the local
 * Handy server is not running), automatically falls back to Groq Whisper
 * (whisper-large-v3-turbo) so voice input keeps working.
 *
 * `allowCloudFallback: false` (used for live partial streaming) never
 * touches the cloud - partial chunks only go through the local model.
 *
 * HARD LOCAL-FIRST MODE: if the provider is `handy-local-whisper` AND the
 * local server is reachable, we NEVER fall back to Groq even on transient
 * errors (busy queue etc.) - this eliminates 429 storms. Cloud fallback is
 * only used when the local server is physically offline.
 */
export async function transcribeWithFallback({
  audio,
  provider,
  selectedProvider,
  allowCloudFallback = true,
}: TranscribeWithFallbackParams): Promise<string> {
  // If the cloud Pluely API is enabled, use it directly.
  const usePluelyAPI = await shouldUsePluelyAPI();
  if (usePluelyAPI) {
    return fetchSTT({ provider: undefined, selectedProvider, audio });
  }

  // A non-local provider (Groq, OpenAI, Deepgram...) - use it directly.
  if (provider && provider.id !== "handy-local-whisper") {
    return fetchSTT({ provider, selectedProvider, audio });
  }

  // If the provider is missing/unknown, do NOT silently fall back to the
  // cloud - this is exactly the path that burned Groq quota before.
  if (!provider) {
    throw new Error(
      "Speech provider config not found. Please configure a provider in Settings."
    );
  }

  // Local Handy path: try it, then fall through to cloud on failure.
  if (provider?.id === "handy-local-whisper") {
    // Check if the local server is actually up before doing anything.
    const handyOnline = await isHandyServerOnline();

    try {
      if (handyOnline) {
        const result = await fetchSTT({ provider, selectedProvider, audio });
        // fetchSTT returns an error/warning string instead of throwing for
        // HTTP errors, so detect that.
        if (
          result &&
          !result.startsWith("Pluely STT Error") &&
          !/HTTP \d+/.test(result) &&
          !result.startsWith("Network error")
        ) {
          return result;
        }
        // Local server returned an error but IS online: do NOT hit Groq.
        // A busy/failed local model is better than a 429 storm.
        return result;
      }
    } catch {
      // transient error - if server is online, never fall back to cloud.
      if (handyOnline && !allowCloudFallback) {
        return "Pluely STT Error: local model unavailable";
      }
      // fall through to cloud fallback only if the server is offline
    }
  }

  // Partial streaming (allowCloudFallback=false): never hit the cloud.
  if (!allowCloudFallback) {
    return "Pluely STT Error: local model unavailable";
  }

  // Cloud fallback: Groq Whisper (only when local server is offline).
  const key = safeLocalStorage.getItem(GROQ_FALLBACK_STORAGE_KEY) || "";
  if (!key) {
    throw new Error(
      "Local STT server is not running and no Groq API key is configured. " +
        "Open Settings → Dev Space → STT Providers and add a key to enable the cloud fallback."
    );
  }

  const groqProvider: TYPE_PROVIDER = {
    id: "groq",
    curl: `curl -X POST https://api.groq.com/openai/v1/audio/transcriptions \\
      -H "Authorization: bearer {{API_KEY}}" \\
      -F "file={{AUDIO}}" \\
      -F model={{MODEL}} \\
      -F temperature=0 \\
      -F response_format=text \\
      -F language={{LANGUAGE}}`,
    responseContentPath: "text",
    streaming: false,
  };

  return fetchSTT({
    provider: groqProvider,
    selectedProvider: {
      provider: "groq",
      variables: { API_KEY: key, MODEL: "whisper-large-v3-turbo" },
    },
    audio,
  });
}

/** Quick TCP health probe of the local Handy STT server (127.0.0.1:8000). */
async function isHandyServerOnline(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const res = (await invoke("handy_server_status_detailed")) as {
      online: boolean;
    };
    return !!res?.online;
  } catch {
    return false;
  }
}

export function getGroqFallbackKey(): string {
  return safeLocalStorage.getItem(GROQ_FALLBACK_STORAGE_KEY) || "";
}

export function setGroqFallbackKey(key: string) {
  safeLocalStorage.setItem(GROQ_FALLBACK_STORAGE_KEY, key.trim());
}
