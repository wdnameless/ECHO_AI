import {
  buildDynamicMessages,
  deepVariableReplacer,
  extractVariables,
  getByPath,
  getStreamingContent,
} from "./common.function";
import { Message, TYPE_PROVIDER } from "@/types";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import curl2Json from "@bany/curl-to-json";
import { shouldUsePluelyAPI } from "./pluely.api";
import { CHUNK_POLL_INTERVAL_MS } from "../chat-constants";
import { getResponseSettings, RESPONSE_LENGTHS, LANGUAGES } from "@/lib";
import { MARKDOWN_FORMATTING_INSTRUCTIONS, STORAGE_KEYS } from "@/config/constants";
import {
  getHumanizerSettings,
  HUMANIZER_INSTRUCTIONS,
  INTERVIEW_MODE_INSTRUCTIONS,
} from "@/config/humanizer.rules";
import { getActiveProfileId, SELF_EVOLUTION_PROFILE_ID } from "../storage/prompt-profiles";
import { buildSelfEvolutionPromptBlock } from "../storage/user-facts";
import { getWebSearchSettings, performWebSearch } from "../web-search";
import { getRagContext } from "@/lib/rag";
import { safeLocalStorage } from "@/lib/storage/helper";
import { detectLanguage } from "@/lib/language-detect";

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

  // RAG context: resume and job description
  const resumeEnabled = safeLocalStorage.getItem(STORAGE_KEYS.RAG_RESUME_ENABLED) === "true";
  const jobEnabled = safeLocalStorage.getItem(STORAGE_KEYS.RAG_JOB_ENABLED) === "true";

  if (resumeEnabled) {
    const resume = await getRagContext("resume");
    if (resume?.content?.trim()) {
      prompts.push(
        `[CONTEXT: MY RESUME]\n${resume.content.trim()}\n[/CONTEXT]`
      );
    }
  }

  if (jobEnabled) {
    const job = await getRagContext("job");
    if (job?.content?.trim()) {
      prompts.push(
        `[CONTEXT: JOB DESCRIPTION]\n${job.content.trim()}\n[/CONTEXT]`
      );
    }
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

  // Self-Evolution Memory & Personal Facts injection
  const activeProfile = getActiveProfileId();
  if (activeProfile === SELF_EVOLUTION_PROFILE_ID) {
    const evolutionBlock = buildSelfEvolutionPromptBlock();
    if (evolutionBlock) {
      prompts.push(evolutionBlock);
    }
  }

  // Live Web Search & Research Injection (if enabled)
  const searchSettings = getWebSearchSettings();
  if (searchSettings.enabled && userMessage && userMessage.trim().length > 5) {
    // Only search if message looks like a question or explicit research request
    const needsSearch =
      userMessage.includes("?") ||
      /кто|что|где|когда|почему|как|сколько|курс|новост|документаци|search|what|how|why|latest|current|docs/i.test(
        userMessage
      );
    if (needsSearch) {
      try {
        const searchResults = await performWebSearch(userMessage);
        if (searchResults.length > 0) {
          const searchBlock = searchResults
            .map((r, i) => `[${i + 1}] ${r.title} (${r.url}):\n${r.snippet}`)
            .join("\n\n");
          prompts.push(
            `[LIVE WEB SEARCH RESULTS - РЕЗУЛЬТАТЫ ПОИСКА В ИНТЕРНЕТЕ]\n${searchBlock}\nИспользуй эти актуальные данные для точного ответа.\n[/LIVE WEB SEARCH RESULTS]`
          );
        }
      } catch (err) {
        console.warn("[AI Response] Live web search failed:", err);
      }
    }
  }

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

    // Set up streaming event listener
    let streamComplete = false;
    const streamChunks: string[] = [];

    const unlisten = await listen("chat_stream_chunk", (event) => {
      const chunk = event.payload as string;
      streamChunks.push(chunk);
    });

    const unlistenComplete = await listen("chat_stream_complete", () => {
      streamComplete = true;
    });

    try {
      // Check if aborted before starting invoke
      if (signal?.aborted) {
        unlisten();
        unlistenComplete();
        return;
      }

      // Start the streaming request fire-and-forget so the polling loop below
      // starts immediately and yields chunks as they arrive
      let streamError: string | null = null;
      invoke("chat_stream_response", {
        userMessage,
        systemPrompt,
        imageBase64,
        history: historyString,
      }).catch((err) => {
        streamError = String(err);
        streamComplete = true;
      });

      // Yield chunks as they come in
      let lastIndex = 0;
      while (!streamComplete) {
        // Check if aborted during streaming
        if (signal?.aborted) {
          unlisten();
          unlistenComplete();
          return;
        }

        // Wait a bit for chunks to accumulate
        await new Promise((resolve) =>
          setTimeout(resolve, CHUNK_POLL_INTERVAL_MS)
        );

        // Check again after timeout
        if (signal?.aborted) {
          unlisten();
          unlistenComplete();
          return;
        }

        // Yield any new chunks
        for (let i = lastIndex; i < streamChunks.length; i++) {
          yield streamChunks[i];
        }
        lastIndex = streamChunks.length;
      }

      // Final abort check before yielding remaining chunks
      if (signal?.aborted) {
        unlisten();
        unlistenComplete();
        return;
      }

      // Yield any remaining chunks
      for (let i = lastIndex; i < streamChunks.length; i++) {
        yield streamChunks[i];
      }

      if (streamError) {
        yield `Pluely API Error: ${streamError}`;
      }
    } finally {
      unlisten();
      unlistenComplete();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    yield `Pluely API Error: ${errorMessage}`;
  }
}

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

    const enhancedSystemPrompt = await buildEnhancedSystemPrompt(
      systemPrompt,
      userMessage
    );

    // Check if we should use Pluely API instead
    const usePluelyAPI = await shouldUsePluelyAPI();
    if (usePluelyAPI) {
      yield* fetchPluelyAIResponse({
        systemPrompt: enhancedSystemPrompt,
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
      curlJson = curl2Json(provider.curl);
    } catch (error) {
      throw new Error(
        `Failed to parse curl: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    const extractedVariables = extractVariables(provider.curl);
    const requiredVars = extractedVariables.filter(
      ({ key }) => key !== "SYSTEM_PROMPT" && key !== "TEXT" && key !== "IMAGE"
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

    const allVariables = {
      ...Object.fromEntries(
        Object.entries(selectedProvider.variables).map(([key, value]) => [
          key.toUpperCase(),
          value,
        ])
      ),
      SYSTEM_PROMPT: enhancedSystemPrompt || "",
    };

    bodyObj = deepVariableReplacer(bodyObj, allVariables);
    let url = deepVariableReplacer(curlJson.url || "", allVariables);

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
      let errorText = "";
      try {
        errorText = await response.text();
      } catch {}
      yield `API request failed: ${response.status} ${response.statusText}${
        errorText ? ` - ${errorText}` : ""
      }`;
      return;
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
      `Error in fetchAIResponse: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
