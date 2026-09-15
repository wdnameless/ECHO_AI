import {
  deepVariableReplacer,
  getByPath,
  blobToBase64,
} from "./common.function";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import { getAsrBaseUrl } from "@/lib/asr-discovery";

import { TYPE_PROVIDER } from "@/types";
import curl2Json from "@bany/curl-to-json";
import { shouldUsePluelyAPI } from "./pluely.api";
import { resolveOutboundHeaders } from "@/lib/host-trust-gate";
import { getResponseSettings } from "@/lib";

// Cache parsed curl configs: curl2Json is pure, so parsing the same provider
// curl on every request is wasted CPU on the hot path.
const curlParseCache = new Map<string, any>();
const CURL_PARSE_CACHE_MAX = 20;

function parseCurlCached(curl: string): any {
  const cached = curlParseCache.get(curl);
  if (cached !== undefined) return cached;
  const parsed = curl2Json(curl);
  if (curlParseCache.size >= CURL_PARSE_CACHE_MAX) {
    const oldest = curlParseCache.keys().next().value;
    if (oldest !== undefined) curlParseCache.delete(oldest);
  }
  curlParseCache.set(curl, parsed);
  return parsed;
}

// Pluely STT function
async function fetchPluelySTT(audio: File | Blob): Promise<string> {
  try {
    // Convert audio to base64
    const audioBase64 = await blobToBase64(audio);

    // Call Tauri command
    const response = await invoke<{
      success: boolean;
      transcription?: string;
      error?: string;
    }>("transcribe_audio", {
      audioBase64,
    });

    if (response.success && response.transcription) {
      return response.transcription;
    } else {
      return response.error || "Transcription failed";
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Pluely STT Error: ${errorMessage}`;
  }
}

export interface STTParams {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  audio: File | Blob;
  /** "high" = final segment (processed first), "low" = live partial. */
  priority?: "high" | "low";
  /** Optional initial prompt / vocabulary hints passed to ASR (e.g. sidecar). */
  prompt?: string;
}

/**
 * Transcribes audio and returns either the transcription or an error/warning message as a single string.
 */
export async function fetchSTT(params: STTParams): Promise<string> {
  let warnings: string[] = [];

  try {
    const { provider, selectedProvider, audio } = params;

    // Check if we should use Pluely API instead
    const usePluelyAPI = await shouldUsePluelyAPI();
    if (usePluelyAPI) {
      return await fetchPluelySTT(audio);
    }

    if (!provider) throw new Error("Provider not provided");
    if (!selectedProvider) throw new Error("Selected provider not provided");
    if (!audio) throw new Error("Audio file is required");

    let curlJson: any;
    try {
      curlJson = parseCurlCached(provider.curl);
    } catch (error) {
      throw new Error(
        `Failed to parse curl: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    // Validate audio file
    const file = audio as File;
    if (file.size === 0) throw new Error("Audio file is empty");
    // maximum size of 10MB
    // const maxSize = 10 * 1024 * 1024;
    // if (file.size > maxSize) {
    //   warnings.push("Audio exceeds 10MB limit");
    // }

    // Build variable map
    const responseSettings = getResponseSettings();
    const defaultLanguage =
      responseSettings.language === "russian" ? "ru" : "en";
    const allVariables: Record<string, string> = {
      LANGUAGE: defaultLanguage,
      ...Object.fromEntries(
        Object.entries(selectedProvider.variables).map(([key, value]) => [
          key.toUpperCase(),
          value,
        ])
      ),
    };

    // Prepare request
    let url = deepVariableReplacer(curlJson.url || "", allVariables);
    const headers = deepVariableReplacer(curlJson.header || {}, allVariables);
    const formData = deepVariableReplacer(curlJson.form || {}, allVariables);

    // Whisper auto-detects language; only pass it when the user set it explicitly.
    // curl2Json parses -F flags into an array of "key=value" strings, so we must
    // remove the matching entry instead of deleting a property.
    const isWhisperAuto =
      provider.id === "groq" || provider.id === "openai-whisper";
    if (isWhisperAuto && formData) {
      const hasExplicitLanguage = Object.keys(selectedProvider.variables).some(
        (k) => k.toUpperCase() === "LANGUAGE"
      );
      if (!hasExplicitLanguage) {
        if (Array.isArray(formData)) {
          const languageIndex = (formData as string[]).findIndex(
            (entry) =>
              String(entry).split("=")[0].trim().toLowerCase() === "language"
          );
          if (languageIndex >= 0) {
            (formData as string[]).splice(languageIndex, 1);
          }
        } else {
          delete (formData as Record<string, string>).language;
        }
      }
    }

    // To Check if API accepts Binary Data
    const isBinaryUpload = provider.curl.includes("--data-binary");
    // Fetch URL Params
    const rawParams = curlJson.params || {};
    // Decode Them
    const decodedParams = Object.fromEntries(
      Object.entries(rawParams).map(([key, value]) => [
        key,
        typeof value === "string" ? decodeURIComponent(value) : "",
      ])
    );
    // Get the Parameters from allVariables
    const replacedParams = deepVariableReplacer(decodedParams, allVariables);

    // Add query parameters to URL
    const queryString = new URLSearchParams(replacedParams).toString();
    if (queryString) {
      url += (url.includes("?") ? "&" : "?") + queryString;
    }

    let finalHeaders = { ...headers };
    let body: FormData | string | Blob;
    const asrBase = await getAsrBaseUrl();
    const isLocalAsr = /127\.0\.0\.1|localhost|0\.0\.0\.0/.test(curlJson.url || "");
    if (isLocalAsr) {
      url = url.replace(
        /^http:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):\d+/,
        asrBase
      );
      if (params.prompt) {
        const trimmedPrompt = params.prompt.slice(0, 500);
        const sep = url.includes("?") ? "&" : "?";
        url += `${sep}prompt=${encodeURIComponent(trimmedPrompt)}`;
      }
    }

    const isForm =
      provider.curl.includes("-F ") || provider.curl.includes("--form");
    if (isForm) {
      const form = new FormData();
      const freshBlob = new Blob([await audio.arrayBuffer()], {
        type: audio.type,
      });
      form.append("file", freshBlob, "audio.wav");
      const headerKeys = Object.keys(headers).map((k) =>
        k.toUpperCase().replace(/[-_]/g, "")
      );

      for (const [key, val] of Object.entries(formData)) {
        if (typeof val !== "string") {
          if (
            !val ||
            headerKeys.includes(key.toUpperCase()) ||
            key.toUpperCase() === "AUDIO"
          )
            continue;
          form.append(key.toLowerCase(), val as string | Blob);
          continue;
        }

        // Check if key is a number, which indicates array-like parsing from curl2json
        if (!isNaN(parseInt(key, 10))) {
          const [formKey, ...formValueParts] = val.split("=");
          const formValue = formValueParts.join("=");

          if (formKey.toLowerCase() === "file") continue; // Already handled by form.append('file', audio)

          if (
            !formValue ||
            headerKeys.includes(formKey.toUpperCase().replace(/[-_]/g, ""))
          )
            continue;

          form.append(formKey, formValue);
        } else {
          if (key.toLowerCase() === "file") continue; // Already handled by form.append('file', audio)
          if (
            !val ||
            headerKeys.includes(key.toUpperCase()) ||
            key.toUpperCase() === "AUDIO"
          )
            continue;
          form.append(key.toLowerCase(), val as string | Blob);
        }
      }
      delete finalHeaders["Content-Type"];
      body = form;
    } else if (isBinaryUpload) {
      // Deepgram-style: raw binary body
      body = new Blob([await audio.arrayBuffer()], {
        type: audio.type,
      });
    } else {
      // Google-style: JSON payload with base64
      allVariables.AUDIO = await blobToBase64(audio);
      const dataObj = curlJson.data ? { ...curlJson.data } : {};
      body = JSON.stringify(deepVariableReplacer(dataObj, allVariables));
    }

    const fetchFunction = (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.includes("127.0.0.1") || urlStr.includes("localhost")) {
        return window.fetch(input, init).catch(() => tauriFetch(input, init));
      }
      return (url?.includes("http") ? tauriFetch(input, init) : window.fetch(input, init))
        .catch(() => window.fetch(input, init));
    };

    // S2: не отправляем учётные данные на хост вне реестра доверенных.
    const outboundHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(
      finalHeaders as Record<string, unknown>
    )) {
      if (typeof value === "string") outboundHeaders[name] = value;
    }
    const trust = await resolveOutboundHeaders(url, outboundHeaders);
    if (!trust.allowed) {
      throw new Error("STT request cancelled: host is not in the trusted list.");
    }

    // Send request — one automatic retry on transient server errors
    // (502/503/429): the local STT queue or a busy gateway should never
    // lose a speech segment.
    let response: Response | null = null;
    let lastErrMsg = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetchFunction(url, {
          method: curlJson.method || "POST",
          headers: trust.headers,
          body: curlJson.method === "GET" ? undefined : body,
        });
      } catch (e) {
        lastErrMsg = `Network error: ${e instanceof Error ? e.message : e}`;
        response = null;
        continue;
      }

      if (response.ok) break;

      let errText = "";
      try {
        errText = await response.text();
      } catch {}
      let errMsg: string;
      try {
        const errObj = JSON.parse(errText);
        errMsg = errObj.message || errText;
      } catch {
        errMsg = errText || response.statusText;
      }
      lastErrMsg = `HTTP ${response.status}: ${errMsg}`;

      const retryable = [502, 503, 429].includes(response.status);
      response = null;
      if (retryable && attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      break;
    }

    if (!response || !response.ok) {
      throw new Error(lastErrMsg || "STT request failed");
    }

    const responseText = await response.text();
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      return [...warnings, responseText.trim()].filter(Boolean).join("; ");
    }

    // Extract transcription
    const rawPath = provider.responseContentPath || "text";
    const path = rawPath.charAt(0).toLowerCase() + rawPath.slice(1);
    const transcription = (getByPath(data, path) || "").trim();

    if (!transcription) {
      return [...warnings, "No transcription found"].join("; ");
    }

    // Return transcription with any warnings
    return [...warnings, transcription].filter(Boolean).join("; ");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg);
  }
}
