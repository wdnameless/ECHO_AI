import {
  deepVariableReplacer,
  getByPath,
  blobToBase64,
} from "./common.function";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import { getAsrBaseUrl, resetAsrBaseUrlCache } from "@/lib/asr-discovery";

import { TYPE_PROVIDER } from "@/types";
import curl2Json from "@bany/curl-to-json";
import { shouldUsePluelyAPI } from "./pluely.api";
import { resolveOutboundHeaders } from "@/lib/host-trust-gate";
import { sttReadiness } from "@/lib/storage/app-paths";
import { getResponseSettings } from "@/lib";

// Cache parsed curl configs: curl2Json is pure, so parsing the same provider
// curl on every request is wasted CPU on the hot path.
const curlParseCache = new Map<string, ParsedSttCurl>();
const CURL_PARSE_CACHE_MAX = 20;

/**
 * Форма разобранного curl, которую реально использует STT-конвейер.
 *
 * Тип библиотеки (`ResultJSON`) не описывает `form` и объявляет `data` как
 * `any`, поэтому фиксируем нужный срез явно — иначе каждое обращение к
 * `curlJson.form` требовало бы приведения на месте использования.
 */
interface ParsedSttCurl {
  url?: string;
  header?: Record<string, unknown>;
  form?: Record<string, unknown> | string[];
  params?: Record<string, string>;
  data?: Record<string, unknown>;
  method?: string;
}

/**
 * Префикс ошибок STT. Это контракт между производителем строки (`fetchSTT`)
 * и потребителями, которые отличают ошибку от расшифровки. Раньше он был
 * продублирован литералом в трёх файлах, и переименование продукта разошлось:
 * проверки остались на старом тексте и ошибки попадали в ленту как реплики.
 */
export const STT_ERROR_PREFIX = "Echo AI STT Error";

/** Отличает сообщение об ошибке STT от реальной расшифровки. */
export function isSttErrorMessage(text: string | null | undefined): boolean {
  return !!text && text.trim().toLowerCase().startsWith(STT_ERROR_PREFIX.toLowerCase());
}

function parseCurlCached(curl: string): ParsedSttCurl {
  const cached = curlParseCache.get(curl);
  if (cached !== undefined) return cached;
  // Проверенное приведение: разборщик принимает только строку curl, а форму
  // результата мы описываем сами (см. ParsedSttCurl).
  const parsed = curl2Json(curl) as unknown as ParsedSttCurl;
  if (curlParseCache.size >= CURL_PARSE_CACHE_MAX) {
    const oldest = curlParseCache.keys().next().value;
    if (oldest !== undefined) curlParseCache.delete(oldest);
  }
  curlParseCache.set(curl, parsed);
  return parsed;
}

// Echo AI STT function
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
    return `${STT_ERROR_PREFIX}: ${errorMessage}`;
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
 * Explains why a local ASR request could not be delivered.
 *
 * The sidecar is only started when a speech model is configured, so a missing
 * model and a crashed engine both surface as "network error" on the loopback
 * address. Asking the backend which of the two it is turns an unactionable
 * message into one the user can fix.
 */
async function describeLocalAsrFailure(): Promise<string | null> {
  try {
    // The backend already distinguishes "no model selected" from "engine never
    // came up", and phrases both for the user. Reuse that verdict instead of
    // second-guessing the sidecar state from the renderer.
    const readiness = await sttReadiness();
    return readiness.engine_running ? null : readiness.reason;
  } catch {
    return null;
  }
}

/**
 * Transcribes audio and returns either the transcription or an error/warning message as a single string.
 */
export async function fetchSTT(params: STTParams): Promise<string> {
  let warnings: string[] = [];

  try {
    const { provider, selectedProvider, audio } = params;

    // Check if we should use Echo AI API instead
    const usePluelyAPI = await shouldUsePluelyAPI();
    if (usePluelyAPI) {
      return await fetchPluelySTT(audio);
    }

    if (!provider) throw new Error("Provider not provided");
    if (!selectedProvider) throw new Error("Selected provider not provided");
    if (!audio) throw new Error("Audio file is required");

    let curlJson: ParsedSttCurl;
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
    const curlForm = curlJson.form;
    const formData = deepVariableReplacer(curlForm || {}, allVariables);

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
    // Set once the server has answered with any status: an HTTP error means the
    // engine is alive, so it must not be reported as "the engine is not running".
    let unreachable = true;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetchFunction(url, {
          method: curlJson.method || "POST",
          headers: trust.headers,
          body: curlJson.method === "GET" ? undefined : body,
        });
        unreachable = false;
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
      // A local engine that is not running looks exactly like a network failure,
      // but the cause is on this machine and the user can act on it: either no
      // speech model is configured, or the sidecar never came up.
      if (isLocalAsr && unreachable) {
        // The engine may have come back on another port in its range; without
        // this, the cached base keeps every later request on the dead one.
        resetAsrBaseUrlCache();
        const explanation = await describeLocalAsrFailure();
        if (explanation) throw new Error(explanation);
      }
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
