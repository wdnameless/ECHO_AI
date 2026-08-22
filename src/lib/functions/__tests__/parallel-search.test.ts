import { describe, it, expect, afterEach, vi } from "vitest";
import {
  buildSearchBlock,
  cacheSearchResults,
  getCachedSearchResults,
  parallelSearchStream,
  resetSearchCacheForTests,
  SEARCH_CACHE_MAX,
  SEARCH_CACHE_TTL_MS,
  shouldSearch,
} from "../parallel-search";

const RESULTS = [
  { title: "Rust docs", url: "https://doc.rust-lang.org", snippet: "Official docs" },
];

function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  return (async () => {
    for await (const chunk of iterable) {
      out.push(chunk);
    }
    return out;
  })();
}

/** Mock LLM stream: delays the FIRST token by delayMs, then yields tokens. */
function makeStream(delayMs: number) {
  return vi.fn(async function* (_prompt: string) {
    await new Promise((r) => setTimeout(r, delayMs));
    yield "first";
    yield "second";
  });
}

function baseOpts(overrides: Record<string, unknown> = {}) {
  return {
    userMessage: "What is rust?",
    basePrompt: "base",
    searchPromise: Promise.resolve(RESULTS),
    createStream: makeStream(0),
    buildPromptWithEntries: (base: string, results: typeof RESULTS) =>
      `${base}::${results[0].title}`,
    onLate: vi.fn(),
    ...overrides,
  };
}

describe("shouldSearch", () => {
  it("triggers on question marks", () => {
    expect(shouldSearch("What is the latest Rust version?")).toBe(true);
    expect(shouldSearch("Какой сейчас курс доллара?")).toBe(true);
  });

  it("triggers on research keywords", () => {
    expect(shouldSearch("latest news on AI")).toBe(true);
    expect(shouldSearch("расскажи новости")).toBe(true);
  });

  it("ignores short or non-question messages", () => {
    expect(shouldSearch("hi")).toBe(false);
    expect(shouldSearch("hello world")).toBe(false);
    expect(shouldSearch("")).toBe(false);
    expect(shouldSearch("   ")).toBe(false);
  });
});

describe("search results cache", () => {
  afterEach(() => {
    resetSearchCacheForTests();
    vi.useRealTimers();
  });

  it("stores and retrieves results by normalized query", () => {
    cacheSearchResults("  What is Rust? ", RESULTS);
    expect(getCachedSearchResults("what is rust?")).toEqual(RESULTS);
  });

  it("returns null for unknown query", () => {
    expect(getCachedSearchResults("nope")).toBeNull();
  });

  it("expires entries after TTL", () => {
    vi.useFakeTimers();
    cacheSearchResults("expiring", RESULTS);
    expect(getCachedSearchResults("expiring")).toEqual(RESULTS);
    vi.advanceTimersByTime(SEARCH_CACHE_TTL_MS + 1);
    expect(getCachedSearchResults("expiring")).toBeNull();
  });

  it("ignores empty results (never caches nothing)", () => {
    cacheSearchResults("empty", []);
    expect(getCachedSearchResults("empty")).toBeNull();
  });

  it("evicts the oldest entry when over capacity", () => {
    for (let i = 0; i < SEARCH_CACHE_MAX + 5; i++) {
      cacheSearchResults(`query-${i}`, [
        { title: `t${i}`, url: `u${i}`, snippet: `s${i}` },
      ]);
    }
    expect(getCachedSearchResults("query-0")).toBeNull();
    const lastIdx = SEARCH_CACHE_MAX + 4;
    expect(getCachedSearchResults(`query-${lastIdx}`)).toEqual([
      { title: `t${lastIdx}`, url: `u${lastIdx}`, snippet: `s${lastIdx}` },
    ]);
  });
});

describe("buildSearchBlock", () => {
  it("formats results with numbers, titles, urls and snippets", () => {
    const block = buildSearchBlock(RESULTS);
    expect(block).toContain("[1] Rust docs (https://doc.rust-lang.org):");
    expect(block).toContain("Official docs");
    expect(block).toContain("LIVE WEB SEARCH RESULTS");
  });
});

describe("parallelSearchStream race", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restarts with enriched prompt when search wins the race", async () => {
    // First token is slow (200ms), search resolves immediately -> search wins.
    const createStream = makeStream(200);
    const chunks = await collect(
      parallelSearchStream(
        baseOpts({
          searchPromise: Promise.resolve(RESULTS),
          createStream,
        })
      )
    );

    expect(chunks).toEqual(["first", "second"]);
    // Two attempts: the aborted first one + the enriched restart.
    expect(createStream).toHaveBeenCalledTimes(2);
    // The second (winning) attempt received the enriched prompt.
    expect(createStream.mock.calls[1][0]).toBe("base::Rust docs");
  });

  it("streams WITHOUT restart when search returns empty results", async () => {
    const createStream = makeStream(200);
    const chunks = await collect(
      parallelSearchStream(
        baseOpts({
          searchPromise: Promise.resolve([]),
          createStream,
        })
      )
    );

    expect(chunks).toEqual(["first", "second"]);
    expect(createStream).toHaveBeenCalledTimes(1);
  });

  it("streams WITHOUT restart when search is disabled (null)", async () => {
    const createStream = makeStream(200);
    const chunks = await collect(
      parallelSearchStream(
        baseOpts({
          searchPromise: Promise.resolve(null),
          createStream,
        })
      )
    );

    expect(chunks).toEqual(["first", "second"]);
    expect(createStream).toHaveBeenCalledTimes(1);
  });

  it("streams immediately when the first token wins, and caches late results", async () => {
    const createStream = makeStream(0); // instant first token
    let resolveSearch!: (r: typeof RESULTS | null) => void;
    const searchPromise = new Promise<typeof RESULTS | null>((resolve) => {
      resolveSearch = resolve;
    });
    const onLate = vi.fn();

    const chunkPromise = collect(
      parallelSearchStream(
        baseOpts({
          searchPromise,
          createStream,
          onLate,
        })
      )
    );

    // Search resolves AFTER the stream already produced the first token.
    setTimeout(() => resolveSearch(RESULTS), 30);
    const chunks = await chunkPromise;
    // Give the fire-and-forget onLate callback a moment to run.
    await new Promise((r) => setTimeout(r, 50));

    expect(chunks).toEqual(["first", "second"]);
    expect(createStream).toHaveBeenCalledTimes(1);
    expect(onLate).toHaveBeenCalledWith("What is rust?", RESULTS);
  });

  it("does not cache late empty results", async () => {
    const createStream = makeStream(0);
    let resolveSearch!: (r: typeof RESULTS | null) => void;
    const searchPromise = new Promise<typeof RESULTS | null>((resolve) => {
      resolveSearch = resolve;
    });
    const onLate = vi.fn();

    const chunkPromise = collect(
      parallelSearchStream(
        baseOpts({
          searchPromise,
          createStream,
          onLate,
        })
      )
    );

    setTimeout(() => resolveSearch([]), 30);
    await chunkPromise;
    expect(onLate).not.toHaveBeenCalled();
  });

  it("propagates stream errors when search cannot save us", async () => {
    const failing = vi.fn(async function* () {
      throw new Error("boom");
    });

    await expect(
      collect(
        parallelSearchStream(
          baseOpts({
            searchPromise: Promise.resolve(null),
            createStream: failing,
          })
        )
      )
    ).rejects.toThrow("boom");
  });

  it("aborts cleanly when the external signal fires", async () => {
    const controller = new AbortController();
    const createStream = makeStream(1000);
    const never = new Promise<typeof RESULTS | null>(() => {});

    const chunksPromise = collect(
      parallelSearchStream(
        baseOpts({
          searchPromise: never,
          createStream,
          signal: controller.signal,
        })
      )
    );

    setTimeout(() => controller.abort(), 20);
    const chunks = await chunksPromise;
    expect(chunks).toEqual([]);
  });
});
