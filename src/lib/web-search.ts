import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { safeLocalStorage } from "./storage/helper";

export const WEB_SEARCH_SETTINGS_KEY = "web_search_settings";

export type SearchProvider = "duckduckgo" | "brave" | "exa" | "tavily";

export interface WebSearchSettings {
  enabled: boolean;
  provider: SearchProvider;
  braveApiKey?: string;
  exaApiKey?: string;
  tavilyApiKey?: string;
  maxResults: number;
}

export const DEFAULT_SEARCH_SETTINGS: WebSearchSettings = {
  enabled: false,
  provider: "duckduckgo",
  maxResults: 3,
};

export function getWebSearchSettings(): WebSearchSettings {
  const raw = safeLocalStorage.getItem(WEB_SEARCH_SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SEARCH_SETTINGS };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SEARCH_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SEARCH_SETTINGS };
  }
}

export function saveWebSearchSettings(settings: WebSearchSettings): void {
  safeLocalStorage.setItem(WEB_SEARCH_SETTINGS_KEY, JSON.stringify(settings));
}

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Free zero-config DuckDuckGo Instant Answers & HTML search.
 * Works out of the box with 0 API keys!
 */
async function searchDuckDuckGo(query: string, maxResults: number = 3): Promise<SearchResultItem[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  try {
    let res: Response;
    try {
      res = await tauriFetch(url);
    } catch {
      res = await fetch(url);
    }
    const data = await res.json();
    const results: SearchResultItem[] = [];

    if (data.AbstractText) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL || "https://duckduckgo.com",
        snippet: data.AbstractText,
      });
    }

    if (Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics) {
        if (results.length >= maxResults) break;
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.slice(0, 50) + "...",
            url: topic.FirstURL,
            snippet: topic.Text,
          });
        }
      }
    }

    return results;
  } catch (err) {
    console.warn("[WebSearch] DuckDuckGo search error:", err);
    return [];
  }
}

/**
 * Brave Search API (high quality web search)
 */
async function searchBrave(query: string, apiKey: string, maxResults: number = 3): Promise<SearchResultItem[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  try {
    let res: Response;
    const headers = {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    };
    try {
      res = await tauriFetch(url, { headers });
    } catch {
      res = await fetch(url, { headers });
    }
    const data = await res.json();
    if (data.web?.results && Array.isArray(data.web.results)) {
      return data.web.results.slice(0, maxResults).map((r: any) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.description || "",
      }));
    }
    return [];
  } catch (err) {
    console.warn("[WebSearch] Brave search error:", err);
    return [];
  }
}

/**
 * Exa.ai semantic neural search
 */
async function searchExa(query: string, apiKey: string, maxResults: number = 3): Promise<SearchResultItem[]> {
  const url = "https://api.exa.ai/search";
  try {
    const body = JSON.stringify({
      query,
      numResults: maxResults,
      useAutoprompt: true,
    });
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    };
    let res: Response;
    try {
      res = await tauriFetch(url, { method: "POST", headers, body });
    } catch {
      res = await fetch(url, { method: "POST", headers, body });
    }
    const data = await res.json();
    if (Array.isArray(data.results)) {
      return data.results.slice(0, maxResults).map((r: any) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.text ? r.text.slice(0, 300) : "",
      }));
    }
    return [];
  } catch (err) {
    console.warn("[WebSearch] Exa search error:", err);
    return [];
  }
}

/**
 * Tavily AI Research Search
 */
async function searchTavily(query: string, apiKey: string, maxResults: number = 3): Promise<SearchResultItem[]> {
  const url = "https://api.tavily.com/search";
  try {
    const body = JSON.stringify({
      query,
      max_results: maxResults,
      search_depth: "basic",
    });
    const headers = {
      "Content-Type": "application/json",
    };
    let res: Response;
    try {
      res = await tauriFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...JSON.parse(body), api_key: apiKey }),
      });
    } catch {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...JSON.parse(body), api_key: apiKey }),
      });
    }
    const data = await res.json();
    if (Array.isArray(data.results)) {
      return data.results.slice(0, maxResults).map((r: any) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.content || "",
      }));
    }
    return [];
  } catch (err) {
    console.warn("[WebSearch] Tavily search error:", err);
    return [];
  }
}

/**
 * Main Web Search & Research Dispatcher
 */
export async function performWebSearch(query: string): Promise<SearchResultItem[]> {
  const settings = getWebSearchSettings();
  if (!settings.enabled) return [];

  const count = settings.maxResults || 3;

  switch (settings.provider) {
    case "brave":
      if (settings.braveApiKey) {
        return searchBrave(query, settings.braveApiKey, count);
      }
      return searchDuckDuckGo(query, count);
    case "exa":
      if (settings.exaApiKey) {
        return searchExa(query, settings.exaApiKey, count);
      }
      return searchDuckDuckGo(query, count);
    case "tavily":
      if (settings.tavilyApiKey) {
        return searchTavily(query, settings.tavilyApiKey, count);
      }
      return searchDuckDuckGo(query, count);
    case "duckduckgo":
    default:
      return searchDuckDuckGo(query, count);
  }
}
