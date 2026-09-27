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

    // 3) The project gateway — the only endpoint proven reachable from inside
    //    this app (see `gatewayTranslate`). Last, because it is slower.
    const viaGateway = await gatewayTranslate(trimmed, tl);
    if (viaGateway) {
      cacheSet(cacheKey, viaGateway);
      return viaGateway;
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
    // NO custom User-Agent.
    //
    // Setting `User-Agent: Mozilla/5.0` on a request made by the native HTTP
    // stack is what gets it refused: measured from inside the running app, the
    // identical URL answers 200 from Node but fails here, and the browser
    // console shows the CSP rejecting the WebView's own attempt
    // («Connecting to 'https://translate.googleapis.com/…' violates the Content
    // Security Policy»), so the plugin is the only path that can work. The
    // AI-response path — the one outbound call that does work — sends no UA at
    // all, only the headers the host-trust gate approves. Matching that shape
    // is the whole point: the provider sees a plain client, not a browser
    // impersonation, and stops blocking it.
    const response = await tauriFetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
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

/** Gateway model used for translation when the fast endpoints are refused. */
const GATEWAY_MODEL = "gemini-3.5-flash-lite";
/** Gateway host, the one outbound endpoint already proven to work from here. */
const GATEWAY_URL = "https://ai-gateway.nullform.cv/v1/chat/completions";

/**
 * Translate through the project gateway — the app's own LLM endpoint.
 *
 * Every free machine-translation endpoint this app tried is refused when called
 * from inside it, and the reason is now measured rather than guessed: the
 * WebView's own `fetch` is blocked by the app's CSP (`connect-src` allows only
 * `'self'` and loopback — the browser console reports «Connecting to
 * 'https://translate.googleapis.com/…' violates the Content Security Policy»),
 * and the remaining path, the HTTP plugin, does not carry a browser profile, so
 * the free endpoints answer 429 to it while the same URL answers 200 from Node.
 * That is a server-side refusal of the native client, not something to out-wait.
 *
 * The gateway is the one host this app already reaches successfully for every AI
 * answer, with the same plugin and the same key, so it is the only translation
 * path that is known to work here. It is slower (measured ~2.5s per call against
 * ~1.1s for GTX) and costs tokens, which is why it stays LAST, after the free
 * providers have had their turn.
 *
 * Returns null on any failure so the caller can fall through or show a dash.
 */
async function gatewayTranslate(text: string, tl: "ru" | "en"): Promise<string | null> {
  try {
    // The key is sent when the user has one saved, but it is not required: this
    // gateway answers an unauthenticated request too (measured: HTTP 200 with no
    // Authorization header), so requiring a key here would disable the only
    // translation path that works from inside the app for users who never
    // configured one.
    const key = await getGatewayKey();

    const target = tl === "en" ? "English" : "Russian";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (key) headers.Authorization = `Bearer ${key}`;

    const response = await tauriFetch(GATEWAY_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: GATEWAY_MODEL,
        max_tokens: 400,
        messages: [
          {
            role: "system",
            // Output-only instruction: anything else and the model's preamble
            // would be stored as the translation.
            content:
              `Translate the user's message into ${target}. ` +
              "Output ONLY the translation, with no preamble, quotes or notes. " +
              "Keep names, numbers and technical terms as they are.",
          },
          { role: "user", content: text.slice(0, 1200) },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== "string" || !raw.trim()) return null;

    // Strip the wrappers a chat model likes to add despite the instruction.
    // Order matters: a fence can wrap a quoted line, so remove the fence FIRST,
    // then the quotes — doing it the other way leaves the quote characters in.
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
    cleaned = cleaned.replace(/^["'«“]([\s\S]*?)["'»”]$/, "$1").trim();
    if (!cleaned) return null;
    if (looksLikeProviderError(cleaned)) return null;
    // An unchanged string is not a translation.
    if (cleaned.toLowerCase() === text.trim().toLowerCase()) return null;
    return cleaned;
  } catch {
    return null;
  }
}

/**
 * The gateway key, from the same secure store the AI provider uses.
 *
 * The provider id matches `nullform-gateway` in the provider catalogue, so a key
 * the user already saved for answering is reused rather than asked for twice.
 */
async function getGatewayKey(): Promise<string | null> {
  try {
    const { getSecret, secretKey } = await import("./storage/secret-store");
    const stored = await getSecret(secretKey.aiProvider("nullform-gateway"));
    return stored && stored.trim() ? stored.trim() : null;
  } catch {
    return null;
  }
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
