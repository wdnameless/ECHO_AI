import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { detectLanguage } from "./language-detect";

/**
 * Ultra-fast machine translation using Google Translate's high-speed public endpoint.
 * Latency is typically 50ms - 120ms (orders of magnitude faster than an LLM).
 *
 * Includes an in-memory cache + small delay between duplicate requests to
 * avoid 429 (Too Many Requests) from the free GTX endpoint.
 */

const translationCache = new Map<string, { text: string; ts: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute
const MAX_CACHE_SIZE = 200;

// Last request timestamp per source text (debounce identical bursts)
const lastSent = new Map<string, number>();
const MIN_INTERVAL_MS = 250;

export async function fastTranslate(
  text: string,
  targetLang?: "ru" | "en"
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  let tl = targetLang;
  if (!tl) {
    const detected = detectLanguage(trimmed);
    // ALWAYS translate to the OPPOSITE language: RU -> EN, EN -> RU.
    // Never translate into the same language the speaker is using.
    tl = detected === "russian" ? "en" : "ru";
  }

  const cacheKey = `${tl}::${trimmed.slice(0, 120)}`;
  const cached = translationCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.text;
  }

  // Debounce identical rapid bursts (live transcript updates)
  const now = Date.now();
  const prevSent = lastSent.get(cacheKey) || 0;
  if (now - prevSent < MIN_INTERVAL_MS) {
    const existing = translationCache.get(cacheKey);
    if (existing) return existing.text;
    return trimmed;
  }
  lastSent.set(cacheKey, now);
  if (lastSent.size > MAX_CACHE_SIZE) {
    lastSent.clear();
  }

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(
    trimmed
  )}`;

  // 1) Local proxy (если сайдкар отдаёт /translate — самый надёжный путь).
  try {
    const local = await fetch(
      `http://127.0.0.1:9877/translate?text=${encodeURIComponent(
        trimmed
      )}&tl=${tl}`
    );
    if (local.ok) {
      const data = await local.json();
      if (data?.translation) {
        cacheSet(cacheKey, data.translation);
        return data.translation;
      }
    }
  } catch {
    /* локальный сервис недоступен — идём дальше */
  }

  // 2) MyMemory — основной провайдер.
  // Google GTX стабильно отвечает 429 на этом эндпоинте, поэтому порядок
  // обратный прежнему: сначала сервис, который реально отвечает, иначе
  // пользователь видел непреобразованный текст.
  const memory = await myMemoryTranslate(trimmed, tl);
  if (memory) {
    cacheSet(cacheKey, memory);
    return memory;
  }

  // 3) Google GTX — резерв.
  try {
    // Try Tauri native fetch first, fallback to browser fetch
    let response: Response;
    try {
      response = await tauriFetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });
    } catch {
      response = await fetch(url);
    }

    if (!response.ok) {
      console.warn(`[Translator] ${response.status}, returning original`);
      return trimmed;
    }

    const data = await response.json();
    // Google GTX format: [[["translated text", "source text", ...], ...], ...]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translatedParts = data[0]
        .map((part: any) => (Array.isArray(part) && part[0] ? part[0] : ""))
        .filter(Boolean);
      const result = translatedParts.join("").trim() || trimmed;

      // Store in cache (bounded)
      cacheSet(cacheKey, result);
      return result;
    }

    return trimmed;
  } catch (error) {
    console.warn("[FastTranslator] Translation failed, returning original:", error);
    return trimmed;
  }
}

function cacheSet(key: string, text: string) {
  if (translationCache.size >= MAX_CACHE_SIZE) {
    const oldest = translationCache.keys().next().value;
    if (oldest !== undefined) translationCache.delete(oldest);
  }
  translationCache.set(key, { text, ts: Date.now() });
}

async function myMemoryTranslate(
  text: string,
  tl: "ru" | "en"
): Promise<string | null> {
  try {
    const pair = tl === "ru" ? "en|ru" : "ru|en";
    const target = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      text.slice(0, 500)
    )}&langpair=${pair}`;

    // Через Rust-мост, а не из WebView: строгая CSP ограничивает connect-src
    // локальными адресами, поэтому прямой fetch отсюда был бы заблокирован.
    let resp: Response;
    try {
      resp = await tauriFetch(target);
    } catch {
      resp = await fetch(target);
    }

    if (!resp.ok) return null;
    const data = await resp.json();
    const t = data?.responseData?.translatedText;
    if (typeof t !== "string" || !t.trim()) return null;

    // MyMemory возвращает исходный текст, когда перевести не удалось.
    // Отдаём null, чтобы вызывающий код попробовал следующий провайдер
    // вместо показа непреобразованного текста как «перевода».
    if (t.trim().toLowerCase() === text.trim().toLowerCase()) return null;

    return t.trim();
  } catch {
    return null;
  }
}
