import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { safeLocalStorage } from "./storage/helper";
import { getSecret, saveSecret, removeSecret, secretKey } from "./storage/secret-store";
import { STORAGE_KEYS } from "@/config/constants";

export const WEB_SEARCH_SETTINGS_KEY = STORAGE_KEYS.WEB_SEARCH_SETTINGS;

export type SearchProvider = "duckduckgo" | "brave" | "exa" | "tavily";

/**
 * Публичные настройки поиска. Ключей здесь нет: они живут в защищённом
 * хранилище бэкенда (`secret-store`), а не в открытом localStorage.
 */
export interface WebSearchSettings {
  enabled: boolean;
  provider: SearchProvider;
  maxResults: number;
}

/** Сервисы поиска, для которых существует слот в защищённом хранилище. */
export type KeyedSearchProvider = "brave" | "exa" | "tavily";

/**
 * Legacy-имена полей с ключами в `web_search_settings`. Существовали до
 * переноса секретов в хранилище; нужны один раз — забрать ключ у пользователя,
 * который обновляется со старой версии, и стереть поле.
 */
const LEGACY_KEY_FIELD: Record<KeyedSearchProvider, string> = {
  brave: "braveApiKey",
  exa: "exaApiKey",
  tavily: "tavilyApiKey",
};

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

/**
 * Сохраняет настройки. Ключи в localStorage не попадают по построению —
 * запись секрета идёт только через {@link setWebSearchKey}.
 */
export function saveWebSearchSettings(settings: WebSearchSettings): void {
  const publicPart: WebSearchSettings = {
    enabled: settings.enabled,
    provider: settings.provider,
    maxResults: settings.maxResults,
  };
  safeLocalStorage.setItem(
    WEB_SEARCH_SETTINGS_KEY,
    JSON.stringify(publicPart)
  );
}

/**
 * Возвращает ключ поискового сервиса из защищённого хранилища.
 *
 * Если ключа там нет, но в localStorage остался ключ старого формата, он
 * переносится в хранилище и стирается из localStorage: иначе секрет остался
 * бы читаемым для любого инжектированного скрипта.
 */
export async function getWebSearchKey(
  service: KeyedSearchProvider
): Promise<string | null> {
  const stored = await getSecret(secretKey.webSearch(service));
  if (stored) return stored;

  const raw = safeLocalStorage.getItem(WEB_SEARCH_SETTINGS_KEY);
  if (!raw) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const field = LEGACY_KEY_FIELD[service];
  const legacy = parsed[field];
  if (typeof legacy !== "string" || !legacy) return null;

  await saveSecret(secretKey.webSearch(service), legacy);
  delete parsed[field];
  safeLocalStorage.setItem(WEB_SEARCH_SETTINGS_KEY, JSON.stringify(parsed));
  return legacy;
}

/**
 * Записывает ключ поискового сервиса в защищённое хранилище и гарантирует,
 * что его копии нет в localStorage.
 */
export async function setWebSearchKey(
  service: KeyedSearchProvider,
  value: string
): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) {
    await saveSecret(secretKey.webSearch(service), trimmed);
  } else {
    await removeSecret(secretKey.webSearch(service));
  }
  clearLegacyKeyField(service);
}

/** Стирает одно legacy-поле ключа из localStorage. */
function clearLegacyKeyField(service: KeyedSearchProvider): void {
  const raw = safeLocalStorage.getItem(WEB_SEARCH_SETTINGS_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const field = LEGACY_KEY_FIELD[service];
    if (!(field in parsed)) return;
    delete parsed[field];
    safeLocalStorage.setItem(WEB_SEARCH_SETTINGS_KEY, JSON.stringify(parsed));
  } catch {
    /* повреждённые настройки перезапишутся при следующем сохранении */
  }
}

/** Стирает все legacy-поля ключей из localStorage. */
export function stripLegacyWebSearchKeys(): void {
  for (const service of Object.keys(LEGACY_KEY_FIELD) as KeyedSearchProvider[]) {
    clearLegacyKeyField(service);
  }
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
 * Основной диспетчер поиска.
 *
 * Ключ берётся из защищённого хранилища, а не из настроек. Пока метка о
 * переносе не выставлена, выполняется разовая зачистка legacy-полей в
 * localStorage — на случай, если пользователь до этого не открывал настройки.
 */
export async function performWebSearch(query: string): Promise<SearchResultItem[]> {
  const settings = getWebSearchSettings();
  if (!settings.enabled) return [];

  const count = settings.maxResults || 3;

  if (settings.provider === "duckduckgo") {
    return searchDuckDuckGo(query, count);
  }

  if (safeLocalStorage.getItem(STORAGE_KEYS.WEB_SEARCH_KEYS_MIGRATED) !== "true") {
    // Move the key into the secure store BEFORE clearing the legacy field.
    //
    // `stripLegacyWebSearchKeys` deletes it, and `getWebSearchKey` is the only
    // code that migrates it — so clearing first destroyed the key outright. The
    // path that used to save it (`migrateSecretsFromLocalStorage`) returns early
    // once `secrets_migrated_v1` is set, which is the normal state of an
    // existing install: measured on a live profile, that flag was `true` while
    // `web_search_keys_migrated` was still unset, so the migration never ran and
    // the first keyed search would have dropped a paid API key. Reading it first
    // migrates as a side effect (the getter saves to the secure store and clears
    // the field itself), and `strip` then finds nothing left to destroy.
    await getWebSearchKey(settings.provider as KeyedSearchProvider);
    stripLegacyWebSearchKeys();
    safeLocalStorage.setItem(STORAGE_KEYS.WEB_SEARCH_KEYS_MIGRATED, "true");
  }

  const service = settings.provider as KeyedSearchProvider;
  const apiKey = await getWebSearchKey(service);
  if (!apiKey) {
    // Ключ не задан: бесплатный поиск остаётся рабочим дефолтом.
    return searchDuckDuckGo(query, count);
  }

  switch (service) {
    case "brave":
      return searchBrave(query, apiKey, count);
    case "exa":
      return searchExa(query, apiKey, count);
    case "tavily":
      return searchTavily(query, apiKey, count);
  }
}
