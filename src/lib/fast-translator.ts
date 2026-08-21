import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { detectLanguage } from "./language-detect";

/**
 * Ultra-fast machine translation using Google Translate's high-speed public endpoint.
 * Latency is typically 50ms - 120ms (orders of magnitude faster than an LLM).
 */
export async function fastTranslate(
  text: string,
  targetLang?: "ru" | "en"
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  // Auto-detect direction if target language is not explicitly provided
  let tl = targetLang;
  if (!tl) {
    const detected = detectLanguage(trimmed);
    tl = detected === "russian" ? "en" : "ru";
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

    if (!response.ok) {
      throw new Error(`Google Translate error: ${response.status}`);
    }

    const data = await response.json();
    // Google GTX format: [[["translated text", "source text", ...], ...], ...]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translatedParts = data[0]
        .map((part: any) => (Array.isArray(part) && part[0] ? part[0] : ""))
        .filter(Boolean);
      return translatedParts.join("").trim();
    }

    return trimmed;
  } catch (error) {
    console.warn("[FastTranslator] Translation failed, returning original:", error);
    return trimmed;
  }
}
