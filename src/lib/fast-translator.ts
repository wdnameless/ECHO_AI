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

    if (response.status === 429) {
      // Rate limited: return the cached text if we have it, else original
      console.warn("[FastTranslator] 429 rate limited, using fallback");
      const existing = translationCache.get(cacheKey);
      return existing ? existing.text : trimmed;
    }

    if (!response.ok) {
      throw new Error(`Google Translate error: ${response.status}`);
    }

    const data = await response.json();
    // Google GTX format: [[["translated text", "source text", ...], ...], ...]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translatedParts = data[0]
        .map((part: any) => (Array.isArray(part) && part[0] ? part[0] : ""))
        .filter(Boolean);
      const result = translatedParts.join("").trim() || trimmed;

      // Store in cache (bounded)
      if (translationCache.size >= MAX_CACHE_SIZE) {
        const oldest = translationCache.keys().next().value;
        if (oldest !== undefined) translationCache.delete(oldest);
      }
      translationCache.set(cacheKey, { text: result, ts: Date.now() });
      return result;
    }

    return trimmed;
  } catch (error) {
    console.warn("[FastTranslator] Translation failed, returning original:", error);
    return trimmed;
  }
}
