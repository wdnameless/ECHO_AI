import {
  buildDynamicMessages,
  canonicalizeVariables,
  deepVariableReplacer,
  extractVariables,
  getByPath,
  getStreamingContent,
} from "./common.function";
import { Message, TYPE_PROVIDER } from "@/types";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Channel, invoke } from "@tauri-apps/api/core";
import curl2Json from "@bany/curl-to-json";
import { resolveOutboundHeaders } from "@/lib/host-trust-gate";
import { getSecret, secretKey } from "@/lib/storage/secret-store";
import { getResponseSettings, LANGUAGES } from "@/lib";
import {
  buildSelfEvolutionPromptBlock,
  getUserStylePreferences,
  isSelfLearningEnabled,
  setSelfEvolutionStyleOverride,
} from "../storage/user-facts";
import { getAnswerLengthOverride } from "@/lib/answer-length-override";
import { getAnswerMode, type AnswerMode } from "@/lib/answer-mode";
import { STORAGE_KEYS } from "@/config/constants";
import {
  getHumanizerSettings,
  pickAnswerOpener,
} from "@/config/humanizer.rules";
import { buildPrompt, THOUGHT_TRACE_PROMPT } from "@/lib/prompt-builder";
import { getWebSearchSettings, performWebSearch, SearchResultItem } from "../web-search";
import {
  buildSearchBlock,
  cacheSearchResults,
  getCachedSearchResults,
  parallelSearchStream,
} from "./parallel-search";
import {
  getRagContext,
  searchMemory,
  type RagContext,
  type MemoryHit,
} from "@/lib/rag";
import { safeLocalStorage } from "@/lib/storage/helper";
import { detectLanguage } from "@/lib/language-detect";
import { getAIProviderVariables } from "@/lib/storage/ai-providers";
import { getActiveProfileId } from "@/lib/storage/prompt-profiles";
import { shouldOfferVisual } from "@/lib/visual-answers";

export { THOUGHT_TRACE_PROMPT };
export type AIStreamEvent =
  | { type: "attempt"; providerId: string }
  | { type: "restart"; providerId: string }
  | { type: "stalled"; providerId: string };

/** Cancellation settles our wait even when the native transport does not. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      void promise.catch(() => {});
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

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

/**
 * Turns an HTTP failure into something the user can act on.
 *
 * A bare "530 - error code: 1033" reads like an app bug, when it is Cloudflare
 * reporting that the tunnel in front of the provider's origin is down. The raw
 * text stays attached so nothing is hidden from someone debugging the provider.
 */
export function describeHttpFailure(
  status: number,
  statusText: string,
  body: string
): string {
  const raw = body.trim();
  const suffix = raw ? ` - ${raw}` : "";
  // Cloudflare 1xxx codes arrive either as a status (530) or inside the body.
  const isTunnelDown =
    status === 530 ||
    /error code:\s*1033/i.test(raw) ||
    /argo tunnel error/i.test(raw);

  if (isTunnelDown) {
    return (
      `Провайдер недоступен: туннель Cloudflare до его сервера не поднят ` +
      `(530, код 1033). Это на стороне провайдера, а не приложения — ` +
      `ключ и адрес в порядке, запрос до шлюза дошёл. Повторите позже или ` +
      `выберите другого провайдера.${suffix}`
    );
  }

  if (status === 401 || status === 403) {
    return (
      `Провайдер отклонил запрос (${status} ${statusText}): ключ не принят. ` +
      `Проверьте API-ключ в настройках провайдера.${suffix}`
    );
  }

  if (status === 429) {
    return `Провайдер ограничил частоту запросов (429). Повторите через несколько секунд.${suffix}`;
  }

  return `API request failed: ${status} ${statusText}${suffix}`;
}

/**
 * Resolves model variable value across case-variants of the "model" key.
 * Resolution rule:
 * - If multiple case-variants exist with different non-empty values,
 *   prefers lowercase "model" (written by fresh UI interactions / dropdowns).
 * - Otherwise returns any non-empty value.
 * - Returns empty string if no valid model is present.
 */
export function resolveModelVariable(
  variables: Record<string, string> | undefined | null
): string {
  if (!variables || typeof variables !== "object") return "";

  const modelEntries = Object.entries(variables).filter(
    ([k, v]) => k.toLowerCase() === "model" && typeof v === "string" && v.trim() !== ""
  );

  if (modelEntries.length === 0) return "";
  if (modelEntries.length === 1) return modelEntries[0][1].trim();

  const distinctValues = new Set(modelEntries.map(([, v]) => v.trim()));
  if (distinctValues.size === 1) {
    return modelEntries[0][1].trim();
  }

  // Conflicting values: prioritize lowercase "model" written by fresh UI interactions
  const lowerMatch = modelEntries.find(([k]) => k === k.toLowerCase());
  if (lowerMatch) {
    return lowerMatch[1].trim();
  }

  return modelEntries[modelEntries.length - 1][1].trim();
}

/**
 * Resolves the effective LLM model name for a provider.
 * Priority: (1) the user-selected `model` variable (case-insensitive, defense against collisions)
 * always wins, (2) a `{{MODEL}}` placeholder in the curl is resolved from variables
 * (same source as 1), (3) as a last resort the literal `"model": "..."`
 * string baked into the provider curl body is parsed out.
 */
export function resolveProviderModel(
  provider: TYPE_PROVIDER | undefined,
  selectedProvider:
    | { provider: string; variables: Record<string, string> }
    | null
    | undefined
): string {
  const vars = selectedProvider?.variables;
  const varsModel = resolveModelVariable(vars);
  if (varsModel) return varsModel;
  // Priority 2: a `{{MODEL}}` placeholder also resolves from variables (same
  // lookup as priority 1, already covered above).
  if (provider?.curl) {
    const m = provider.curl.match(/"model"\s*:\s*"([^"{]+)"/);
    if (m?.[1]) return m[1];
  }
  return "";
}


// ---------------------------------------------------------------------------
// Parallel web search: results are raced against the first token so search
// NEVER blocks the answer. If search wins, the request silently restarts with
// the enriched prompt (user sees nothing). If the first token wins, results
// are cached and injected on the next turn.
// ---------------------------------------------------------------------------

export async function buildEnhancedSystemPrompt(
  baseSystemPrompt?: string,
  userMessage?: string,
  mode?: AnswerMode,
  profileId?: string
): Promise<string> {
  const activeMode = mode ?? getAnswerMode();
  const responseSettings = getResponseSettings();
  const activeProfileId = profileId ?? getActiveProfileId();

  // RAG context + meeting memory: fetched concurrently in ONE Promise.all
  const resumeEnabled = safeLocalStorage.getItem(STORAGE_KEYS.RAG_RESUME_ENABLED) === "true";
  const jobEnabled = safeLocalStorage.getItem(STORAGE_KEYS.RAG_JOB_ENABLED) === "true";
  const memoryEnabled = safeLocalStorage.getItem(STORAGE_KEYS.RAG_MEMORY_ENABLED) !== "false";

  let resumePromise: Promise<RagContext | null> = Promise.resolve(null);
  if (resumeEnabled) {
    try {
      resumePromise = Promise.resolve(getRagContext("resume")).catch(() => null);
    } catch {
      resumePromise = Promise.resolve(null);
    }
  }

  let jobPromise: Promise<RagContext | null> = Promise.resolve(null);
  if (jobEnabled) {
    try {
      jobPromise = Promise.resolve(getRagContext("job")).catch(() => null);
    } catch {
      jobPromise = Promise.resolve(null);
    }
  }

  let memoryPromise: Promise<MemoryHit[]> = Promise.resolve([]);
  if (memoryEnabled && userMessage?.trim()) {
    try {
      memoryPromise = Promise.resolve(searchMemory(userMessage, 3)).catch(() => []);
    } catch {
      memoryPromise = Promise.resolve([]);
    }
  }

  const [resumeCtx, jobCtx, memoryHits] = await Promise.all([
    resumePromise,
    jobPromise,
    memoryPromise,
  ]);

  const openerLang = detectLanguage(userMessage || "") === "russian" ? "ru" : "en";
  const opener = pickAnswerOpener(openerLang);

  const detected = detectLanguage(userMessage || "");
  const effectiveLanguage =
    detected === "russian" ? "russian" : responseSettings.language;

  const languageOption = LANGUAGES.find(
    (l) => l.id === effectiveLanguage
  );
  const languagePrompt = languageOption?.prompt?.trim();

  let evolutionBlock: string | null = null;
  if (isSelfLearningEnabled()) {
    try {
      const cachedStyle = getUserStylePreferences();
      setSelfEvolutionStyleOverride(cachedStyle);
    } catch {
      // getStyleFromDbOrCache is resilient and never throws
    }
    evolutionBlock = buildSelfEvolutionPromptBlock();
  }

  return buildPrompt({
    baseSystemPrompt,
    mode: activeMode,
    userMessage,
    offerVisual: shouldOfferVisual(activeProfileId, userMessage || ""),
    answerLengthOverride: getAnswerLengthOverride(),
    humanizer: getHumanizerSettings(),
    opener: activeMode !== "thought" ? (opener ?? null) : undefined,
    resumeContent: resumeCtx?.content?.trim() ?? null,
    jobContent: jobCtx?.content?.trim() ?? null,
    memoryHits,
    languagePrompt,
    evolutionBlock,
    separator: " ",
  });
}

// Hosted transport uses the same text/error contract as configured providers.
async function* fetchPluelyAIResponse(params: {
  systemPrompt?: string;
  userMessage: string;
  imagesBase64?: string[];
  history?: Message[];
  signal?: AbortSignal;
  onEvent?: (event: AIStreamEvent) => void;
}): AsyncIterable<string> {
  const { systemPrompt, userMessage, imagesBase64 = [], history = [], signal, onEvent } = params;
  if (signal?.aborted) return;
  const channel = new Channel<string>();
  const pending: string[] = [];
  let done = false;
  let streamError: unknown;
  let resolveNext: (() => void) | null = null;
  const wake = () => { resolveNext?.(); resolveNext = null; };
  channel.onmessage = (chunk) => {
    if (signal?.aborted) return;
    if (chunk === "\u{0}__DONE__\u{0}") done = true;
    else pending.push(chunk);
    wake();
  };
  void invoke("chat_stream_response", {
    userMessage,
    systemPrompt,
    imageBase64: imagesBase64.length === 1 ? imagesBase64[0] : imagesBase64.length ? imagesBase64 : undefined,
    history: history.length ? JSON.stringify(history.map((msg) => ({
      role: msg.role, content: [{ type: "text", text: msg.content }],
    }))) : undefined,
    onEvent: channel,
  }).catch((error) => { streamError = error; }).finally(() => { done = true; wake(); });
  let stalled = false;
  try {
    while (!signal?.aborted) {
      if (pending.length) { yield pending.shift()!; continue; }
      if (done) break;
      const timer = !stalled ? setTimeout(() => {
        if (signal?.aborted) return;
        stalled = true;
        onEvent?.({ type: "stalled", providerId: "pluely" });
      }, 25_000) : undefined;
      try {
        await abortable(new Promise<void>((resolve) => {
          resolveNext = resolve;
          if (pending.length || done) wake();
        }), signal);
      } finally {
        clearTimeout(timer);
      }
    }
    if (!signal?.aborted && streamError) throw new Error(String(streamError));
  } finally {
    channel.onmessage = () => {};
    resolveNext = null;
  }
}

// Core streaming implementation (Echo AI API or configured provider).
// Extracted so the parallel-search race can restart it with an enriched
// system prompt without duplicating the request-building logic.
async function* streamAIResponse(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  systemPrompt?: string;
  history?: Message[];
  userMessage: string;
  imagesBase64?: string[];
  signal?: AbortSignal;
  onEvent?: (event: AIStreamEvent) => void;
}): AsyncGenerator<string, void, unknown> {
  try {
    const {
      provider,
      selectedProvider,
      systemPrompt,
      history = [],
      userMessage,
      imagesBase64 = [],
      signal,
    } = params;

    // Check if already aborted
    if (signal?.aborted) {
      return;
    }

    // An absent provider explicitly selects the hosted transport.
    if (!provider) {
      yield* fetchPluelyAIResponse({
        systemPrompt,
        userMessage,
        imagesBase64,
        history,
        signal,
        onEvent: params.onEvent,
      });
      return;
    }
    if (!selectedProvider) {
      throw new Error(`Selected provider not provided`);
    }

    let curlJson;
    try {
      curlJson = parseCurlCached(provider.curl);
    } catch (error) {
      throw new Error(
        `Failed to parse curl: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    const extractedVariables = extractVariables(provider.curl);
    const requiredVars = extractedVariables.filter(
      ({ key }) =>
        key !== "system_prompt" &&
        key !== "text" &&
        key !== "image" &&
        key !== "reasoning_effort" &&
        key !== "thinking_budget"
    );
    const providerVariables: Record<string, string> = {
      ...(selectedProvider.variables ?? {}),
    };

    // S4: после миграции ключ живёт в защищённом хранилище, а не в переменных
    // провайдера. Читаем его ДО проверки обязательных переменных: иначе запрос
    // отклонялся с «Не настроен API-ключ», хотя ключ уже был сохранён в
    // хранилище ОС, и единственным выходом оставалось продублировать его в
    // открытом localStorage.
    const hasKeyInVariables = Object.entries(providerVariables).some(
      ([k, v]) =>
        k.toLowerCase().includes("api_key") && !!v && v.trim() !== ""
    );
    if (!hasKeyInVariables && selectedProvider.provider) {
      const storedKey = await abortable(getSecret(
        secretKey.aiProvider(selectedProvider.provider)
      ), signal);
      if (storedKey) {
        const apiKeyName =
          extractedVariables.find((v) =>
            v.key.toLowerCase().includes("api_key")
          )?.key ?? "api_key";
        providerVariables[apiKeyName] = storedKey;
      }
    }

    for (const { key } of requiredVars) {
      const found = Object.entries(providerVariables).find(
        ([k, v]) =>
          k.toLowerCase() === key.toLowerCase() && v && v.trim() !== ""
      );
      if (!found) {
        if (key.toLowerCase().includes("api_key")) {
          throw new Error(
            `Не настроен API-ключ для провайдера «${provider?.id ?? "AI"}». Откройте настройки провайдеров и укажите ключ.`
          );
        }
        throw new Error(
          `Не заполнена переменная: ${key}. Настройте её в настройках провайдеров.`
        );
      }
    }

    if (!userMessage) {
      throw new Error("User message is required");
    }
    if (imagesBase64.length > 0 && !provider.curl.includes("{{IMAGE}}")) {
      throw new Error(
        `Provider ${provider?.id ?? "unknown"} does not support image input`
      );
    }

    let bodyObj: any = curlJson.data
      ? JSON.parse(JSON.stringify(curlJson.data))
      : {};
    const messagesKey = Object.keys(bodyObj).find((key) =>
      ["messages", "contents", "conversation", "history"].includes(key)
    );

    if (messagesKey && Array.isArray(bodyObj[messagesKey])) {
      const finalMessages = buildDynamicMessages(
        bodyObj[messagesKey],
        history,
        userMessage,
        imagesBase64
      );
      bodyObj[messagesKey] = finalMessages;
    }

    const canonicalVars = canonicalizeVariables(providerVariables);
    const userVariables = Object.fromEntries(
      Object.entries(canonicalVars).map(([key, value]) => [
        key.toUpperCase(),
        value,
      ])
    );

    // Zero-reasoning by default: "minimal" gives the fastest first token.
    // In thought mode, reasoning is not minimal ("medium").
    const activeMode = getAnswerMode();
    const defaultEffort = activeMode === "thought" ? "medium" : "minimal";
    let reasoningEffort =
      userVariables["REASONING_EFFORT"] || defaultEffort;
    if (activeMode === "thought" && reasoningEffort === "minimal") {
      reasoningEffort = "medium";
    }
    const allVariables = {
      ...userVariables,
      SYSTEM_PROMPT: systemPrompt || "",
      REASONING_EFFORT: reasoningEffort,
    };

    bodyObj = deepVariableReplacer(bodyObj, allVariables);

    // Hard model override: the user's selected model variable ALWAYS wins over
    // any literal model string baked into the provider curl. Without this, a
    // template with a hardcoded "gemini-3.6-flash" silently ignores a newer
    // model configured in settings. Sibling model-like keys (model_id,
    // model_name, modelVersion) that don't match the chosen value are removed
    // so the provider can never fall back to a stale model.
    const selectedModel = resolveModelVariable(selectedProvider.variables);
    if (
      typeof bodyObj === "object" &&
      bodyObj !== null &&
      selectedModel?.trim()
    ) {
      bodyObj.model = selectedModel.trim();
      for (const siblingKey of ["model_id", "model_name", "modelVersion"]) {
        if (
          siblingKey in bodyObj &&
          typeof bodyObj[siblingKey] === "string" &&
          bodyObj[siblingKey] !== selectedModel.trim()
        ) {
          delete bodyObj[siblingKey];
        }
      }
    }
    let url = deepVariableReplacer(curlJson.url || "", allVariables);

    // Clean up empty reasoning_effort or normalize "none" / "0" for 0-delay instant responses
    if (typeof bodyObj === "object" && bodyObj !== null) {
      if (
        bodyObj.reasoning_effort === "" ||
        bodyObj.reasoning_effort === "{{REASONING_EFFORT}}"
      ) {
        delete bodyObj.reasoning_effort;
      } else if (
        bodyObj.reasoning_effort === "0" ||
        bodyObj.reasoning_effort === "none" ||
        bodyObj.reasoning_effort === "disabled" ||
        (activeMode === "thought" && bodyObj.reasoning_effort === "minimal")
      ) {
        // Normalize disabled reasoning to "minimal" for fastest first-token delivery, or "medium" in thought mode
        bodyObj.reasoning_effort = activeMode === "thought" ? "medium" : "minimal";
      }

      // Gemini rejects empty image fields with HTTP 400 ("Unable to process
      // input image"). Remove any image-related field left empty after
      // variable replacement (no screenshot attached this turn).
      for (const k of Object.keys(bodyObj)) {
        const v = bodyObj[k];
        if (
          /image/i.test(k) &&
          (v === "" ||
            v === null ||
            (Array.isArray(v) && v.length === 0))
        ) {
          delete bodyObj[k];
        }
      }
    }

    const headers = deepVariableReplacer(curlJson.header || {}, allVariables);
    headers["Content-Type"] = "application/json";

    if (provider?.streaming) {
      if (typeof bodyObj === "object" && bodyObj !== null) {
        const streamKey = Object.keys(bodyObj).find(
          (k) => k.toLowerCase() === "stream"
        );
        if (streamKey) {
          bodyObj[streamKey] = true;
        } else {
          bodyObj.stream = true;
        }
      }
    }

    // Cap answer length unless the provider template specifies it: interview
    // answers are short by design, and a hard cap makes generation finish
    // roughly 2x faster (fewer tokens to stream).
    if (
      typeof bodyObj === "object" &&
      bodyObj !== null &&
      bodyObj.max_tokens === undefined &&
      bodyObj.maxOutputTokens === undefined
    ) {
      bodyObj.max_tokens = 600;
    }

    const fetchFunction = url?.includes("http") ? tauriFetch : fetch;

    // S2: не отправляем учётные данные на хост вне реестра доверенных.
    const outboundHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(
      (headers ?? {}) as Record<string, unknown>
    )) {
      if (typeof value === "string") outboundHeaders[name] = value;
    }
    const body = curlJson.method === "GET" ? undefined : JSON.stringify(bodyObj);
    const trust = await abortable(resolveOutboundHeaders(url, outboundHeaders, body), signal);
    if (signal?.aborted) return;
    if (!trust.allowed) {
      throw new Error("Запрос отменён: хост не входит в список доверенных.");
    }

    let response;
    try {
      response = await abortable(fetchFunction(url, {
        method: curlJson.method || "POST",
        headers: trust.headers,
        body,
        signal,
        // R13: redirects are disabled. The trust decision above was made for
        // THIS host; following a redirect would let a provider (or a proxy in
        // front of it) hand the request — and any provider key carried in a
        // custom header from the user's curl template — to a host this gate
        // never approved. reqwest strips only `authorization`/`cookie` on a
        // cross-host hop, and this app can put keys in arbitrary header names,
        // so disabling the hop is the only reliable guarantee.
        maxRedirections: trust.maxRedirections,
      }), signal);
    } catch (fetchError) {
      // Check if aborted
      if (
        signal?.aborted ||
        (fetchError instanceof Error && fetchError.name === "AbortError")
      ) {
        return; // Silently return on abort
      }
      throw new Error(`Network error during API request: ${
        fetchError instanceof Error ? fetchError.message : "Unknown error"
      }`);
    }

    if (!response.ok) {
      // One automatic retry on transient gateway errors (502/503/429/530):
      // overloaded gateways recover within a few hundred milliseconds and the
      // answer should never be lost to a blip. 530 is Cloudflare's tunnel
      // failure, which also clears on its own once the tunnel reconnects.
      if ([502, 503, 429, 530].includes(response.status)) {
        await abortable(new Promise<void>((resolve) => setTimeout(resolve, 500)), signal);
        try {
          response = await abortable(fetchFunction(url, {
            method: curlJson.method || "POST",
            // `trust.headers`, not the raw `headers`: on an untrusted host the
            // user may have chosen to proceed WITHOUT credentials, and the gate
            // returns a sanitized copy for exactly that case. Sending the raw map
            // here re-attached the API key to the retry, so a single 502 leaked
            // the secret the user had just declined to send.
            headers: trust.headers,
            body,
            signal,
            // R13: same guarantee as the first attempt — the retry must not
            // follow a redirect either. Omitting it here made the security
            // posture depend on whether the gateway happened to return a 502.
            maxRedirections: trust.maxRedirections,
          }), signal);
        } catch (error) {
          if (signal?.aborted) return;
          throw error;
        }
      }

      if (!response || !response.ok) {
        let errorText = "";
        try {
          if (response) errorText = await abortable(response.text(), signal);
        } catch (bodyErr) {
          console.debug("[ai-response] failed to read error body:", bodyErr);
        }
        if (signal?.aborted) return;
        throw new Error(describeHttpFailure(
          response?.status ?? 0,
          response?.statusText ?? "error",
          errorText
        ));
      }
    }

    if (!provider?.streaming) {
      let json;
      try {
        json = await abortable(response.json(), signal);
      } catch (parseError) {
        if (signal?.aborted) return;
        throw new Error(`Failed to parse non-streaming response: ${
          parseError instanceof Error ? parseError.message : "Unknown error"
        }`);
      }
      const content =
        getByPath(json, provider?.responseContentPath || "") || "";
      if (signal?.aborted) return;
      if (typeof content !== "string") throw new Error("Invalid provider response content");
      yield content;
      return;
    }

    if (!response.body) {
      throw new Error("Streaming not supported or response body missing");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let stalled = false;
    const onAbort = () => {
      try {
        void reader.cancel().catch(() => { /* Native cancellation is best-effort. */ });
      } catch { /* A released reader is already stopped. */ }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      while (!signal?.aborted) {
        // One read, one wait. A stall notification never abandons this promise.
        const pendingRead = reader.read();
        const timer = !stalled ? setTimeout(() => {
          if (signal?.aborted) return;
          stalled = true;
          params.onEvent?.({ type: "stalled", providerId: provider.id ?? "unknown" });
        }, 25_000) : undefined;
        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await abortable(pendingRead, signal);
        } finally {
          clearTimeout(timer);
        }
      const { done, value } = readResult;

      // Check if aborted before processing
      if (signal?.aborted) {
        onAbort();
        return;
      }

      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = done ? "" : lines.pop() || "";
      for (const line of lines) {
        if (signal?.aborted) return;
        if (line.startsWith("data:")) {
          const trimmed = line.substring(5).trim();
          if (!trimmed) continue;
          if (trimmed === "[DONE]") return;
          let parsed;
          try {
            parsed = JSON.parse(trimmed);
          } catch (error) {
            throw new Error(`Failed to parse streaming response: ${
              error instanceof Error ? error.message : String(error)
            }`);
          }
          if (parsed.error) {
            throw new Error(typeof parsed.error === "string"
              ? parsed.error : parsed.error.message || JSON.stringify(parsed.error));
          }
          const delta = getStreamingContent(parsed, provider.responseContentPath || "");
          if (typeof delta === "string" && delta) yield delta;
        }
      }
      if (done) break;
    }
  } finally {
      signal?.removeEventListener("abort", onAbort);
      // Never await cancellation: native transports can leave its promise pending.
      if (!signal?.aborted) onAbort();
    }
  } catch (error) {
    if (params.signal?.aborted) return;
    throw error;
  }
}


/**
 * Public entry point. Web search (when enabled) runs IN PARALLEL with the
 * request and never blocks the first token:
 *  - search wins  -> the request silently restarts with the enriched prompt
 *                    (the user sees nothing, the answer just uses fresh data);
 *  - token wins   -> the answer streams immediately and the search results
 *                    are cached for the next turn.
 */
export async function* fetchAIResponse(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  allProviders?: TYPE_PROVIDER[];
  onEvent?: (event: AIStreamEvent) => void;
  systemPrompt?: string;
  history?: Message[];
  userMessage: string;
  imagesBase64?: string[];
  signal?: AbortSignal;
  mode?: AnswerMode;
  profileId?: string;
}): AsyncIterable<string> {
  const { userMessage, signal } = params;
  if (signal?.aborted) return;
  const emit = (event: AIStreamEvent) => {
    if (!signal?.aborted) params.onEvent?.(event);
  };

  // Web search overlap (R01): kick off search in parallel with prompt build and LLM connect.
  // Never block the first token with a serial await race.
  let searchPromise: Promise<SearchResultItem[] | null> = Promise.resolve(null);
  let cachedResults: SearchResultItem[] | null = null;
  const settings = getWebSearchSettings();
  if (settings.enabled && userMessage.trim()) {
    const cached = getCachedSearchResults(userMessage);
    if (cached) {
      cachedResults = cached;
    } else {
      searchPromise = performWebSearch(userMessage)
        .then((results) => (results && results.length > 0 ? results : null))
        .catch(() => null);
    }
  }

  // Build the base prompt (RAG, humanizer, etc.) - runs concurrently with search.
  if (signal?.aborted) return;
  let baseSystemPrompt: string;
  try {
    baseSystemPrompt = await abortable(
      buildEnhancedSystemPrompt(
        params.systemPrompt,
        userMessage,
        params.mode,
        params.profileId
      ),
      signal
    );
  } catch (error) {
    if (signal?.aborted) return;
    throw error;
  }

  async function* executeStream(
    prompt: string,
    attemptSignal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    if (!params.provider) {
      emit({ type: "attempt", providerId: "pluely" });
      yield* streamAIResponse({
        ...params,
        systemPrompt: prompt,
        onEvent: emit,
        signal: attemptSignal,
      });
      return;
    }

    const candidates: (TYPE_PROVIDER | undefined)[] = [];
    const seenIds = new Set<string>();

    if (params.provider) {
      candidates.push(params.provider);
      if (params.provider.id) {
        seenIds.add(params.provider.id);
      }
    }

    if (params.allProviders) {
      for (const p of params.allProviders) {
        if (!p.id || !seenIds.has(p.id)) {
          if (p.id) seenIds.add(p.id);
          candidates.push(p);
        }
      }
    }

    if (candidates.length === 0) {
      candidates.push(undefined);
    }

    const triedIds: string[] = [];
    let lastError = "";

    for (let i = 0; i < candidates.length; i++) {
      if (attemptSignal?.aborted) {
        return;
      }

      const candidate = candidates[i];
      const candidateId = candidate?.id ?? "unknown";
      triedIds.push(candidateId);

      const candidateSelected = {
        provider: candidateId,
        variables:
          candidateId === params.selectedProvider.provider
            ? { ...params.selectedProvider.variables }
            : getAIProviderVariables(candidateId),
      };
      let yieldedRealContent = false;
      let candidateError = "";
      if (i > 0) emit({ type: "restart", providerId: candidateId });
      emit({ type: "attempt", providerId: candidateId });
      try {
        for await (const chunk of streamAIResponse({
          ...params,
          provider: candidate,
          selectedProvider: candidateSelected,
          systemPrompt: prompt,
          onEvent: emit,
          signal: attemptSignal,
        })) {
          if (attemptSignal?.aborted) return;
          if (chunk.length > 0) yieldedRealContent = true;
          yield chunk;
        }
        if (attemptSignal?.aborted) return;
        if (yieldedRealContent) return;
        candidateError = "Провайдер вернул пустой ответ";
      } catch (error) {
        if (attemptSignal?.aborted) return;
        candidateError = error instanceof Error ? error.message : String(error);
      }

      if (attemptSignal?.aborted) {
        return;
      }

      lastError = candidateError;
    }

    throw new Error(
      `Все провайдеры недоступны (пробовали: ${triedIds.join(", ")}): ${lastError}`
    );
  }

  // Fast path: cached search results enrich prompt immediately
  if (cachedResults && cachedResults.length > 0) {
    const enrichedPrompt = `${baseSystemPrompt} ${buildSearchBlock(cachedResults)}`;
    yield* executeStream(enrichedPrompt, signal);
    return;
  }

  // Fast path: search disabled
  if (!settings.enabled || !userMessage.trim()) {
    yield* executeStream(baseSystemPrompt, signal);
    return;
  }

  // Parallel path: web search overlaps with LLM connect and prompt build
  yield* parallelSearchStream({
    userMessage,
    basePrompt: baseSystemPrompt,
    searchPromise,
    createStream: (prompt, attemptSignal) =>
      executeStream(prompt, attemptSignal),
    buildPromptWithEntries: (basePrompt, results) =>
      `${basePrompt} ${buildSearchBlock(results)}`,
    onLate: (query, results) => cacheSearchResults(query, results),
    signal,
  });
}
