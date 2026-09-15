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
import { shouldUsePluelyAPI } from "./pluely.api";
import { getResponseSettings, RESPONSE_LENGTHS, LANGUAGES } from "@/lib";
import { MARKDOWN_FORMATTING_INSTRUCTIONS, STORAGE_KEYS } from "@/config/constants";
import {
  getHumanizerSettings,
  HUMANIZER_INSTRUCTIONS,
  INTERVIEW_MODE_INSTRUCTIONS,
} from "@/config/humanizer.rules";
import { buildSelfEvolutionPromptBlock } from "../storage/user-facts";
import { getWebSearchSettings, performWebSearch, SearchResultItem } from "../web-search";
import {
  buildSearchBlock,
  cacheSearchResults,
  getCachedSearchResults,
} from "./parallel-search";
import { getRagContext } from "@/lib/rag";
import { safeLocalStorage } from "@/lib/storage/helper";
import { detectLanguage } from "@/lib/language-detect";

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

async function buildEnhancedSystemPrompt(
  baseSystemPrompt?: string,
  userMessage?: string
): Promise<string> {
  const responseSettings = getResponseSettings();
  const prompts: string[] = [];

  if (baseSystemPrompt) {
    prompts.push(baseSystemPrompt);
  }

  const lengthOption = RESPONSE_LENGTHS.find(
    (l) => l.id === responseSettings.responseLength
  );
  if (lengthOption?.prompt?.trim()) {
    prompts.push(lengthOption.prompt);
  }

  const detected = detectLanguage(userMessage || "");
  const effectiveLanguage =
    detected === "russian" ? "russian" : responseSettings.language;

  const languageOption = LANGUAGES.find(
    (l) => l.id === effectiveLanguage
  );
  if (languageOption?.prompt?.trim()) {
    prompts.push(languageOption.prompt);
  }

  // Add markdown formatting instructions
  prompts.push(MARKDOWN_FORMATTING_INSTRUCTIONS);

  // RAG context: resume and job description (fetched in parallel - they are
  // independent DB reads, no reason to serialize them).
  const resumeEnabled = safeLocalStorage.getItem(STORAGE_KEYS.RAG_RESUME_ENABLED) === "true";
  const jobEnabled = safeLocalStorage.getItem(STORAGE_KEYS.RAG_JOB_ENABLED) === "true";

  const [resumeCtx, jobCtx] = await Promise.all([
    resumeEnabled ? getRagContext("resume") : Promise.resolve(null),
    jobEnabled ? getRagContext("job") : Promise.resolve(null),
  ]);

  if (resumeCtx?.content?.trim()) {
    prompts.push(
      `[CONTEXT: MY RESUME]\n${resumeCtx.content.trim()}\n[/CONTEXT]`
    );
  }

  if (jobCtx?.content?.trim()) {
    prompts.push(
      `[CONTEXT: JOB DESCRIPTION]\n${jobCtx.content.trim()}\n[/CONTEXT]`
    );
  }

  // Humanizer rules
  const humanizer = getHumanizerSettings();
  if (humanizer.enabled) {
    prompts.push(HUMANIZER_INSTRUCTIONS);
    if (humanizer.interviewMode) {
      prompts.push(INTERVIEW_MODE_INSTRUCTIONS);
    }
    if (humanizer.customStyle?.trim()) {
      prompts.push(
        `Match this personal speaking style: ${humanizer.customStyle.trim()}`
      );
    }
  }

  // Self-Evolution Memory & Personal Facts injection (ALWAYS on): every
  // like/dislike immediately shapes the next answer, and the strict RU/EN
  // language rule lives inside this block.
  {
    const evolutionBlock = buildSelfEvolutionPromptBlock();
    if (evolutionBlock) {
      prompts.push(evolutionBlock);
    }
  }

  // NOTE: Live web search is no longer awaited here - it runs in parallel
  // inside fetchAIResponse and never blocks the first token.

  // Anti-filler & question intent instruction
  prompts.push(
    "CONVERSATIONAL FILTER RULE: If the user input is merely a conversational acknowledgment, reaction, or filler sound (e.g. 'угу', 'мгм', 'ага', 'да', 'ну', 'хм', 'ок', 'yeah', 'uh-huh', 'mhm', 'got it') without a substantive question or topic, DO NOT replicate the filler or generate a lengthy answer. Only answer when an actual question, technical query, or request is made."
  );

  return prompts.join(" ");
}

// Pluely AI streaming function
async function* fetchPluelyAIResponse(params: {
  systemPrompt?: string;
  userMessage: string;
  imagesBase64?: string[];
  history?: Message[];
  signal?: AbortSignal;
}): AsyncIterable<string> {
  try {
    const {
      systemPrompt,
      userMessage,
      imagesBase64 = [],
      history = [],
      signal,
    } = params;

    // Check if already aborted before starting
    if (signal?.aborted) {
      return;
    }

    // Convert history to the expected format
    let historyString: string | undefined;
    if (history.length > 0) {
      // Create a copy before reversing to avoid mutating the original array
      const formattedHistory = [...history].reverse().map((msg) => ({
        role: msg.role,
        content: [{ type: "text", text: msg.content }],
      }));
      historyString = JSON.stringify(formattedHistory);
    }

    // Handle images - can be string or array
    let imageBase64: any = undefined;
    if (imagesBase64.length > 0) {
      imageBase64 = imagesBase64.length === 1 ? imagesBase64[0] : imagesBase64;
    }

    // Stream chunks straight through a Tauri Channel - no event bus, no
    // 16ms polling loop. The Rust side pushes each delta into the channel
    // as it arrives, so the first token reaches the UI with zero added
    // latency.
    const channel = new Channel<string>();
    let streamError: string | null = null;
    let done = false;

    // Fire-and-forget: the Rust side pushes deltas into the channel.
    invoke("chat_stream_response", {
      userMessage,
      systemPrompt,
      imageBase64,
      history: historyString,
      onEvent: channel,
    })
      .catch((err) => {
        streamError = String(err);
        done = true;
      })
      .finally(() => {
        done = true;
      });

    // The channel is a pull-based queue: onmessage fires as chunks arrive.
    // We bridge it into an async generator so the caller can `for await`.
    const pending: string[] = [];
    let resolveNext: (() => void) | null = null;

    channel.onmessage = (chunk) => {
      pending.push(chunk);
      resolveNext?.();
      resolveNext = null;
    };

    while (true) {
      if (signal?.aborted) {
        return;
      }
      if (pending.length > 0) {
        const chunk = pending.shift()!;
        if (chunk === "\u{0}__DONE__\u{0}") {
          break;
        }
        yield chunk;
        continue;
      }
      if (done) {
        break;
      }
      // Wait for the next chunk. Re-check after registering the resolver to
      // close the race where a chunk arrives between the checks above and
      // the await below (otherwise the loop would hang forever).
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
        if (pending.length > 0 || done) {
          resolveNext = null;
          resolve();
        }
      });
    }

    if (streamError) {
      yield `Echo AI API Error: ${streamError}`;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    yield `Echo AI API Error: ${errorMessage}`;
  }
}

// Core streaming implementation (Pluely API or configured provider).
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

    // Check if we should use Pluely API instead
    const usePluelyAPI = await shouldUsePluelyAPI();
    if (usePluelyAPI) {
      yield* fetchPluelyAIResponse({
        systemPrompt,
        userMessage,
        imagesBase64,
        history,
        signal,
      });
      return;
    }
    if (!provider) {
      throw new Error(`Provider not provided`);
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
    const providerVariables = selectedProvider.variables ?? {};
    for (const { key } of requiredVars) {
      const found = Object.entries(providerVariables).find(
        ([k, v]) =>
          k.toLowerCase() === key.toLowerCase() && v && v.trim() !== ""
      );
      if (!found) {
        throw new Error(
          `Missing required variable: ${key}. Please configure it in settings.`
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

    const canonicalVars = canonicalizeVariables(selectedProvider.variables);
    const userVariables = Object.fromEntries(
      Object.entries(canonicalVars).map(([key, value]) => [
        key.toUpperCase(),
        value,
      ])
    );

    // Zero-reasoning by default: "minimal" gives the fastest first token.
    // The user can still override via provider variables (e.g. REASONING_EFFORT=high)
    // for complex questions.
    const reasoningEffort =
      userVariables["REASONING_EFFORT"] || "minimal";

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
        bodyObj.reasoning_effort === "disabled"
      ) {
        // Normalize disabled reasoning to "minimal" for fastest first-token delivery
        bodyObj.reasoning_effort = "minimal";
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

    let response;
    try {
      response = await fetchFunction(url, {
        method: curlJson.method || "POST",
        headers,
        body: curlJson.method === "GET" ? undefined : JSON.stringify(bodyObj),
        signal,
      });
    } catch (fetchError) {
      // Check if aborted
      if (
        signal?.aborted ||
        (fetchError instanceof Error && fetchError.name === "AbortError")
      ) {
        return; // Silently return on abort
      }
      yield `Network error during API request: ${
        fetchError instanceof Error ? fetchError.message : "Unknown error"
      }`;
      return;
    }

    if (!response.ok) {
      // One automatic retry on transient gateway errors (502/503/429):
      // overloaded gateways recover within a few hundred milliseconds and
      // the answer should never be lost to a blip.
      if ([502, 503, 429].includes(response.status)) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          response = await fetchFunction(url, {
            method: curlJson.method || "POST",
            headers,
            body: curlJson.method === "GET" ? undefined : JSON.stringify(bodyObj),
            signal,
          });
        } catch {
          /* fall through to the error below */
        }
      }

      if (!response || !response.ok) {
        let errorText = "";
        try {
          if (response) errorText = await response.text();
        } catch {}
        yield `API request failed: ${response?.status ?? "network"} ${
          response?.statusText ?? "error"
        }${errorText ? ` - ${errorText}` : ""}`;
        return;
      }
    }

    if (!provider?.streaming) {
      let json;
      try {
        json = await response.json();
      } catch (parseError) {
        yield `Failed to parse non-streaming response: ${
          parseError instanceof Error ? parseError.message : "Unknown error"
        }`;
        return;
      }
      const content =
        getByPath(json, provider?.responseContentPath || "") || "";
      yield content;
      return;
    }

    if (!response.body) {
      yield "Streaming not supported or response body missing";
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      // Check if aborted
      if (signal?.aborted) {
        reader.cancel();
        return;
      }

      let readResult;
      try {
        readResult = await reader.read();
      } catch (readError) {
        // Check if aborted
        if (
          signal?.aborted ||
          (readError instanceof Error && readError.name === "AbortError")
        ) {
          return; // Silently return on abort
        }
        yield `Error reading stream: ${
          readError instanceof Error ? readError.message : "Unknown error"
        }`;
        return;
      }
      const { done, value } = readResult;
      if (done) break;

      // Check if aborted before processing
      if (signal?.aborted) {
        reader.cancel();
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const trimmed = line.substring(5).trim();
          if (!trimmed || trimmed === "[DONE]") continue;
          try {
            const parsed = JSON.parse(trimmed);
            const delta = getStreamingContent(
              parsed,
              provider?.responseContentPath || ""
            );
            if (delta) {
              yield delta;
            }
          } catch (e) {
            // Ignore parsing errors for partial JSON chunks
          }
        }
      }
    }
  } catch (error) {
    throw new Error(
      `Error in streamAIResponse: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
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
  systemPrompt?: string;
  history?: Message[];
  userMessage: string;
  imagesBase64?: string[];
  signal?: AbortSignal;
}): AsyncIterable<string> {
  const { userMessage, signal } = params;

  // Web search with a HARD budget: await it for at most ~1.1s, then start
  // the stream either way. Single request (no abort+restart), predictable
  // worst-case latency; late results are cached and used next turn.
  let searchResults: SearchResultItem[] | null = null;
  try {
    const settings = getWebSearchSettings();
    if (settings.enabled && userMessage.trim()) {
      const cached = getCachedSearchResults(userMessage);
      if (cached) {
        searchResults = cached;
      } else {
        searchResults = await Promise.race([
          performWebSearch(userMessage).catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), 1100)),
        ]);
        if (searchResults && searchResults.length > 0) {
          cacheSearchResults(userMessage, searchResults);
        }
      }
    }
  } catch {
    searchResults = null;
  }

  // Build the base prompt (RAG, humanizer, etc.) - no search inside.
  const baseSystemPrompt = await buildEnhancedSystemPrompt(
    params.systemPrompt,
    userMessage
  );

  const enrichedPrompt =
    searchResults && searchResults.length > 0
      ? `${baseSystemPrompt} ${buildSearchBlock(searchResults)}`
      : baseSystemPrompt;

  yield* streamAIResponse({
    ...params,
    systemPrompt: enrichedPrompt,
    signal,
  });
}
