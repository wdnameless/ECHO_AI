import type { SearchResultItem } from "../web-search";

// ---------------------------------------------------------------------------
// Parallel web search orchestration - pure logic, unit-tested.
//
// The web search runs in parallel with the LLM request and never blocks the
// first token:
//  - search wins  -> the first (aborted) attempt is thrown away and the
//                    request silently restarts with the enriched prompt;
//  - token wins   -> the answer streams immediately and the results are
//                    cached (onLate) for the next turn.
// ---------------------------------------------------------------------------

export const SEARCH_CACHE_TTL_MS = 5 * 60_000;
export const SEARCH_CACHE_MAX = 30;

const searchResultsCache = new Map<
  string,
  { results: SearchResultItem[]; ts: number }
>();

export function resetSearchCacheForTests(): void {
  searchResultsCache.clear();
}

/** Whether a message looks like a question / research request worth searching. */
export function shouldSearch(userMessage: string): boolean {
  return (
    userMessage.trim().length > 5 &&
    (userMessage.includes("?") ||
      /кто|что|где|когда|почему|как|сколько|курс|новост|документаци|search|what|how|why|latest|current|docs/i.test(
        userMessage
      ))
  );
}

export function getCachedSearchResults(query: string): SearchResultItem[] | null {
  const key = query.trim().toLowerCase().slice(0, 120);
  const entry = searchResultsCache.get(key);
  if (entry && Date.now() - entry.ts < SEARCH_CACHE_TTL_MS) {
    return entry.results;
  }
  return null;
}

export function cacheSearchResults(
  query: string,
  results: SearchResultItem[]
): void {
  if (!results || results.length === 0) return;
  const key = query.trim().toLowerCase().slice(0, 120);
  if (searchResultsCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchResultsCache.keys().next().value;
    if (oldest !== undefined) searchResultsCache.delete(oldest);
  }
  searchResultsCache.set(key, { results, ts: Date.now() });
}

/**
 * Нейтрализует HTML-спецсимволы в тексте из внешнего поискового сервиса.
 * Сниппеты попадают в контекст промпта, а их источник не контролируется:
 * разметка из внешнего ответа не должна читаться как управляющая.
 */
function escapeExternalText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[[\]]/g, (ch) => (ch === "[" ? "&#91;" : "&#93;"));
}

export function buildSearchBlock(results: SearchResultItem[]): string {
  const searchBlock = results
    .map(
      (r, i) =>
        `[${i + 1}] ${escapeExternalText(r.title)} (${escapeExternalText(
          r.url
        )}):\n${escapeExternalText(r.snippet)}`
    )
    .join("\n\n");
  return `[LIVE WEB SEARCH RESULTS - РЕЗУЛЬТАТЫ ПОИСКА В ИНТЕРНЕТЕ]\n${searchBlock}\nИспользуй эти актуальные данные для точного ответа.\n[/LIVE WEB SEARCH RESULTS]`;
}

export interface ParallelSearchOptions {
  userMessage: string;
  basePrompt: string;
  searchPromise: Promise<SearchResultItem[] | null>;
  /** Creates the actual LLM stream for a given (possibly enriched) prompt. */
  createStream: (
    prompt: string,
    signal?: AbortSignal
  ) => AsyncGenerator<string, void, unknown>;
  /** Builds the enriched system prompt from base prompt + search results. */
  buildPromptWithEntries: (
    basePrompt: string,
    results: SearchResultItem[]
  ) => string;
  /** Called when the search finished AFTER the first token (late results). */
  onLate?: (query: string, results: SearchResultItem[]) => void;
  signal?: AbortSignal;
}

export async function* parallelSearchStream(
  opts: ParallelSearchOptions
): AsyncIterable<string> {
  const {
    userMessage,
    basePrompt,
    searchPromise,
    createStream,
    buildPromptWithEntries,
    onLate,
    signal,
  } = opts;

  // External abort cascades to the CURRENT active attempt, so a caller
  // abort cuts the stream short immediately (even mid-request).
  let activeController = new AbortController();
  const onExternalAbort = () => activeController.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  const externalAbort = new Promise<null>((resolve) => {
    signal?.addEventListener("abort", () => resolve(null), { once: true });
  });

  const firstChunkPromise = (async () => {
    const controller = activeController;
    try {
      const iterator = createStream(basePrompt, controller.signal);
      const first = await iterator.next();
      return { iterator, first, controller, error: null as unknown };
    } catch (err) {
      return {
        iterator: null as AsyncGenerator<string, void, unknown> | null,
        first: { done: true as const, value: undefined as unknown as string },
        controller,
        error: err,
      };
    }
  })();

  // If the first attempt already failed/emptied, give the search a chance;
  // otherwise null (token wins) or an external abort null.
  const searchOrNull = await Promise.race([
    searchPromise,
    firstChunkPromise.then(({ first }) =>
      first.done || !first.value ? searchPromise : null
    ),
    externalAbort,
  ]);

  if (searchOrNull && searchOrNull.length > 0) {
    // Search finished before the first token: kill the first attempt and
    // silently restart with the enriched prompt. The user never sees the
    // aborted first attempt.
    activeController.abort();
    activeController = new AbortController();
    const enrichedPrompt = buildPromptWithEntries(basePrompt, searchOrNull);
    yield* createStream(enrichedPrompt, activeController.signal);
    return;
  }

  if (signal?.aborted) {
    return;
  }

  signal?.removeEventListener("abort", onExternalAbort);
  const { iterator, first, error } = await firstChunkPromise;
  if (error) {
    throw error instanceof Error
      ? error
      : new Error("Unknown error in parallel search stream");
  }
  if (signal?.aborted) {
    return;
  }
  if (iterator && !first.done) {
    yield first.value;
    for await (const chunk of iterator) {
      if (signal?.aborted) {
        return;
      }
      yield chunk;
    }
  }

  // Cache results for the next turn if they arrived late.
  searchPromise.then((results) => {
    if (results && results.length > 0) {
      onLate?.(userMessage, results);
    }
  });
}
