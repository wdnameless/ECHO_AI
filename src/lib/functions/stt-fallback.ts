import { fetchSTT, isSttErrorMessage } from "./stt.function";
import { scrubAsrHallucinations } from "@/lib/asr-hallucinations";
import { shouldUsePluelyAPI } from "./pluely.api";
import { TYPE_PROVIDER } from "@/types";

/**
 * 100% LOCAL STT pipeline.
 *
 * The app ONLY uses the local Handy STT server (faster-whisper / Handy GPU
 * / local CPU whisper in-process). Cloud STT providers (Groq, OpenAI, etc.)
 * are NOT called automatically - ever. This permanently kills the 429
 * "rate limit reached" storms.
 *
 * Chain inside the local server:
 *   1. faster-whisper (CTranslate2, GPU) - primary, model stays in memory
 *   2. Handy GPU model (Nemotron 3.5 ASR Streaming, Vulkan) - fallback
 *   3. local openai-whisper (CPU) - last resort
 *
 * If the local server is offline the request fails with a clear error.
 */

const LOCAL_PROVIDER: TYPE_PROVIDER = {
  id: "handy-local-whisper",
  curl: `curl -X POST "http://127.0.0.1:9877/v1/asr/transcribe" \\
      -H "Content-Type: audio/wav" \\
      --data-binary {{AUDIO}}`,
  responseContentPath: "text",
  streaming: false,
};

export interface TranscribeWithFallbackParams {
  provider?: TYPE_PROVIDER;
  selectedProvider: { provider: string; variables: Record<string, string> };
  audio: Blob | File;
  /** Kept for API compatibility; cloud fallback is no longer automatic. */
  allowCloudFallback?: boolean;
  /** "high" = final segment (processed first), "low" = live partial. */
  priority?: "high" | "low";
  /** Optional initial prompt / vocabulary hints. */
  prompt?: string;
}

export async function transcribeWithFallback({
  audio,
  provider: _provider,
  selectedProvider,
  priority = "high",
  prompt,
}: TranscribeWithFallbackParams): Promise<string> {
  // If the cloud Echo AI API is enabled, use it directly (explicit user choice).
  const usePluelyAPI = await shouldUsePluelyAPI();
  if (usePluelyAPI) {
    return fetchSTT({ provider: undefined, selectedProvider, audio, priority, prompt });
  }

  // LOCAL ONLY: the local Handy server handles every request. The selected
  // provider is ignored for transcription - cloud STT (Groq, OpenAI, ...)
  // is never called, which is what caused the 429 rate-limit storms.
  const localVariables = {
    ...(selectedProvider?.variables || {}),
    // Keep API_KEY/MODEL if the user configured them for the local server;
    // fall back to safe defaults otherwise.
    API_KEY:
      selectedProvider?.variables?.["API_KEY"] ||
      selectedProvider?.variables?.["api_key"] ||
      "local",
    MODEL:
      selectedProvider?.variables?.["MODEL"] ||
      selectedProvider?.variables?.["model"] ||
      "small",
  };

  const result = await fetchSTT({
    provider: LOCAL_PROVIDER,
    selectedProvider: {
      provider: "handy-local-whisper",
      variables: localVariables,
    },
    audio,
    priority,
    prompt,
  });

  // Error paths keep their contract: callers tell failure from speech by the
  // prefix, so an error must still be thrown, never returned as a transcription.
  //
  // An EMPTY result is not one of these: it is what the engine answers for a
  // segment that held no speech (verified: 1s of silence returns `{"text": ""}`
  // with HTTP 200). Throwing on it lit the «Локальный движок распознавания не
  // отвечает» banner while the engine was healthy and answering every request.
  if (
    result === null ||
    result === undefined ||
    isSttErrorMessage(result) ||
    result.startsWith("Network error")
  ) {
    // Local server is offline or failed - clear error, NO cloud fallback.
    throw new Error(
      "Локальный движок распознавания не отвечает. Если модель не выбрана — " +
        "выберите её в «SST Models»; если выбрана — запустите захват заново " +
        "или перезапустите Echo AI."
    );
  }

  // Boilerplate the recogniser invents over non-speech audio is not speech:
  // returning it made the feed show «Субтитры сделал DimaTorzok» as the
  // interviewer's own line, and the AI answered the credits. It is scrubbed
  // rather than rejected, because the credits are spliced into real speech as
  // often as they replace it and the words around them are genuine. An empty
  // result means the engine heard nothing intelligible, which is how callers
  // already read silence — not an engine fault.
  return scrubAsrHallucinations(result);
}
