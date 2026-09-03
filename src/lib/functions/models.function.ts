import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import curl2Json from "@bany/curl-to-json";
import { deepVariableReplacer } from "./common.function";

export interface FetchModelsOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Resolves the models endpoint URL given a provider ID and base/chat URL.
 * Replaces known paths:
 * - /chat/completions -> /models
 * - /messages -> /models
 * - /completions -> /models
 * - /api/generate -> /api/tags
 * Special cases:
 * - Ollama: uses /api/tags
 */
export function resolveModelsUrl(providerId: string, requestUrl: string): string {
  try {
    const parsed = new URL(requestUrl);
    const pathname = parsed.pathname;

    // Ollama uses /api/tags (whether called via native endpoint or v1 compatibility)
    if (providerId === "ollama") {
      parsed.pathname = "/api/tags";
      parsed.search = "";
      return parsed.toString();
    }

    if (pathname.includes("/chat/completions")) {
      parsed.pathname = pathname.replace(/\/chat\/completions\/?$/, "/models");
    } else if (pathname.includes("/messages")) {
      parsed.pathname = pathname.replace(/\/messages\/?$/, "/models");
    } else if (pathname.includes("/completions")) {
      parsed.pathname = pathname.replace(/\/completions\/?$/, "/models");
    } else if (pathname.includes("/api/generate")) {
      parsed.pathname = pathname.replace(/\/api\/generate\/?$/, "/api/tags");
    } else {
      const cleanPath = pathname.replace(/\/+$/, "");
      if (!cleanPath.endsWith("/models")) {
        parsed.pathname = `${cleanPath}/models`;
      }
    }

    parsed.search = "";
    return parsed.toString();
  } catch {
    if (providerId === "ollama") {
      return requestUrl.replace(/\/v1\/.*|\/api\/.*|$/, "/api/tags");
    }
    if (requestUrl.includes("/chat/completions")) {
      return requestUrl.replace(/\/chat\/completions\/?$/, "/models");
    }
    if (requestUrl.includes("/messages")) {
      return requestUrl.replace(/\/messages\/?$/, "/models");
    }
    if (requestUrl.includes("/completions")) {
      return requestUrl.replace(/\/completions\/?$/, "/models");
    }
    if (requestUrl.includes("/api/generate")) {
      return requestUrl.replace(/\/api\/generate\/?$/, "/api/tags");
    }
    return `${requestUrl.replace(/\/+$/, "")}/models`;
  }
}

/**
 * Extracts a model name/id from an unknown entry safely without unchecked type casting.
 */
function extractModelIdentifier(item: unknown): string | null {
  if (typeof item === "string" && item.trim()) {
    return item.trim();
  }
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    if (typeof record.id === "string" && record.id.trim()) {
      return record.id.trim();
    }
    if (typeof record.name === "string" && record.name.trim()) {
      return record.name.trim();
    }
    if (typeof record.model === "string" && record.model.trim()) {
      return record.model.trim();
    }
  }
  return null;
}

/**
 * Normalizes models response into a sorted string list of model IDs/names.
 * Supports:
 * - OpenAI-compatible: { data: [{ id: "gpt-4" }] }
 * - Ollama: { models: [{ name: "llama3:latest", model: "llama3:latest" }] }
 * - Direct array: ["gpt-4", "gpt-3.5-turbo"] or [{ id: "..." }]
 */
export function normalizeModelsResponse(json: unknown): string[] {
  if (!json || typeof json !== "object") {
    return [];
  }

  const result: string[] = [];

  if ("data" in json) {
    const record = json as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      for (const item of record.data) {
        const id = extractModelIdentifier(item);
        if (id) {
          result.push(id);
        }
      }
    }
  } else if ("models" in json) {
    const record = json as Record<string, unknown>;
    if (Array.isArray(record.models)) {
      for (const item of record.models) {
        const id = extractModelIdentifier(item);
        if (id) {
          result.push(id);
        }
      }
    }
  } else if (Array.isArray(json)) {
    for (const item of json) {
      const id = extractModelIdentifier(item);
      if (id) {
        result.push(id);
      }
    }
  }

  const seen: Record<string, true> = {};
  const unique: string[] = [];
  for (const m of result) {
    if (!seen[m]) {
      seen[m] = true;
      unique.push(m);
    }
  }
  unique.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return unique;
}

/**
 * Fetches available models for an AI provider.
 * Extracts the request URL and headers from the provider's curl template,
 * replaces {{VARIABLES}}, resolves the models endpoint, and calls GET via tauriFetch.
 */
export async function fetchProviderModels(
  providerId: string,
  curl: string,
  variables: Record<string, string>,
  options?: FetchModelsOptions
): Promise<string[]> {
  const parsedCurl = curl2Json(curl);
  if (!parsedCurl || !parsedCurl.url) {
    throw new Error("Не удалось извлечь URL из шаблона curl провайдера");
  }

  let rawUrl = parsedCurl.url;
  for (const [k, v] of Object.entries(variables)) {
    rawUrl = rawUrl.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
  }

  const modelsUrl = resolveModelsUrl(providerId, rawUrl);

  const headers: Record<string, string> = {};
  if (parsedCurl.header && typeof parsedCurl.header === "object") {
    const replacedHeaders = deepVariableReplacer(parsedCurl.header, variables);
    for (const [k, v] of Object.entries(replacedHeaders)) {
      if (typeof v === "string") {
        headers[k] = v;
      }
    }
  }

  const apiKey = variables.API_KEY || variables.api_key;
  if (apiKey) {
    if (providerId === "claude") {
      if (!headers["x-api-key"]) {
        headers["x-api-key"] = apiKey;
      }
      if (!headers["anthropic-version"]) {
        headers["anthropic-version"] = "2023-06-01";
      }
    } else {
      const hasAuth = Object.keys(headers).some((h) => h.toLowerCase() === "authorization");
      if (!hasAuth && providerId !== "ollama") {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
    }
  }

  if (options?.headers) {
    Object.assign(headers, options.headers);
  }

  const response = await tauriFetch(modelsUrl, {
    method: "GET",
    headers,
    signal: options?.signal,
  });

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    const snippet = errorBody ? `: ${errorBody.slice(0, 150)}` : "";
    throw new Error(`HTTP ${response.status} (${response.statusText || "Error"})${snippet}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`Не удалось разобрать JSON ответа: ${err instanceof Error ? err.message : "Unknown JSON error"}`);
  }

  const models = normalizeModelsResponse(data);
  if (models.length === 0) {
    throw new Error("Провайдер вернул пустой список моделей");
  }

  return models;
}
