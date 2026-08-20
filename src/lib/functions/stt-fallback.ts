import { fetchSTT } from "./stt.function";
import { shouldUsePluelyAPI } from "./pluely.api";
import { TYPE_PROVIDER } from "@/types";
import { safeLocalStorage } from "@/lib/storage/helper";

export const GROQ_FALLBACK_STORAGE_KEY = "stt_fallback_groq_key";

export interface TranscribeWithFallbackParams {
  provider?: TYPE_PROVIDER;
  selectedProvider: { provider: string; variables: Record<string, string> };
  audio: Blob | File;
}

/**
 * Tries the user-selected STT provider first. If it fails (e.g. the local
 * Handy server is not running), automatically falls back to Groq Whisper
 * (whisper-large-v3-turbo) so voice input keeps working.
 */
export async function transcribeWithFallback({
  audio,
  provider,
  selectedProvider,
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

  // Local Handy path: try it, then fall through to cloud on failure.
  if (provider?.id === "handy-local-whisper") {
    try {
      const result = await fetchSTT({ provider, selectedProvider, audio });
      // fetchSTT returns an error/warning string instead of throwing for
      // HTTP errors, so detect that and fall through to Groq.
      if (
        result &&
        !result.startsWith("Pluely STT Error") &&
        !/HTTP \d+/.test(result) &&
        !result.startsWith("Network error")
      ) {
        return result;
      }
    } catch {
      // fall through to cloud fallback
    }
  }

  // Cloud fallback: Groq Whisper.
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

export function getGroqFallbackKey(): string {
  return safeLocalStorage.getItem(GROQ_FALLBACK_STORAGE_KEY) || "";
}

export function setGroqFallbackKey(key: string) {
  safeLocalStorage.setItem(GROQ_FALLBACK_STORAGE_KEY, key.trim());
}
