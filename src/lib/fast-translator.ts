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

/**
 * Requests in flight, keyed like the cache.
 *
 * Concurrent callers for the same text share one request. This replaced a
 * debounce that returned the source text to the second caller inside a 250ms
 * window — see the note in `fastTranslate` for what that did on screen.
 */
const inFlightTranslations = new Map<string, Promise<string>>();

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

  // Share one request between concurrent callers instead of skipping the second.
  //
  // This replaces a 250ms debounce that returned the SOURCE text when a repeat
  // arrived inside the window: `SubtitleFeed` runs two workers over the same
  // queue and re-runs the effect on every entry change, so the same key was
  // requested twice, the second call got the original Russian back, and the feed
  // stored that as the "translation" and marked the row done — it was never
  // retried. On screen every row read «русский переводит русский».
  const inFlight = inFlightTranslations.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async (): Promise<string> => {
    let url = "";
    try {
      const gtxUrl = new URL("https://translate.googleapis.com/translate_a/single");
      gtxUrl.searchParams.set("client", "gtx");
      gtxUrl.searchParams.set("sl", "auto");
      gtxUrl.searchParams.set("tl", tl);
      gtxUrl.searchParams.set("dt", "t");
      gtxUrl.searchParams.set("q", trimmed);
      url = gtxUrl.toString();
    } catch {
      return trimmed;
    }

    // 1) Google GTX — основной провайдер.
    //
    // MyMemory was primary until it ran out of its free daily quota and started
    // answering 429 with a warning *sentence* in the body. That body passed the
    // echo guard (it is not equal to the input) and would have been rendered as
    // the translation; the caller now also rejects provider error text outright.
    // GTX has no such quota and answered in ~90ms measured from this machine.
    const gtx = await gtxTranslate(url, trimmed);
    if (gtx) {
      cacheSet(cacheKey, gtx);
      return gtx;
    }

    // 2) MyMemory — резерв, когда GTX недоступен.
    const memory = await myMemoryTranslate(trimmed, tl);
    if (memory) {
      cacheSet(cacheKey, memory);
      return memory;
    }

    return trimmed;
  })();

  inFlightTranslations.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inFlightTranslations.delete(cacheKey);
  }
}


/** Rejects provider error bodies that are not translations at all. */
function looksLikeProviderError(text: string): boolean {
  return /mymemory warning|available free translations|usage ?limit|quota|rate ?limit/i.test(text);
}

/**
 * Google's public `translate_a/single` endpoint.
 *
 * Returns null on any failure so the caller can try the next provider instead of
 * showing the untouched input as a translation.
 */
async function gtxTranslate(url: string, source: string): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await tauriFetch(url, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;

    const translatedParts = data[0]
      .map((part: unknown) => (Array.isArray(part) && typeof part[0] === "string" ? part[0] : ""))
      .filter(Boolean);
    const result = translatedParts.join("").trim();
    if (!result || looksLikeProviderError(result)) return null;
    // An identical string is not a translation.
    if (result.toLowerCase() === source.trim().toLowerCase()) return null;
    return result;
  } catch {
    return null;
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
    const memUrl = new URL("https://api.mymemory.translated.net/get");
    memUrl.searchParams.set("q", text.slice(0, 500));
    memUrl.searchParams.set("langpair", pair);
    const target = memUrl.toString();
    let resp: Response;
    try {
      resp = await tauriFetch(target, { signal: AbortSignal.timeout(2000) });
    } catch {
      return null;
    }

    if (!resp.ok) return null;
    const data = (await resp.json()) as { responseData?: { translatedText?: string } } | null;
    const t = data?.responseData?.translatedText;
    if (typeof t !== "string" || !t.trim()) return null;

    // MyMemory возвращает исходный текст, когда перевести не удалось.
    // Отдаём null, чтобы вызывающий код попробовал следующий провайдер
    // вместо показа непреобразованного текста как «перевода».
    if (t.trim().toLowerCase() === text.trim().toLowerCase()) return null;
    if (looksLikeProviderError(t)) return null;

    return t.trim();
  } catch {
    return null;
  }
}
