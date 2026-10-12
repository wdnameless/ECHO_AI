import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReadableStream } from "node:stream/web";
import type { TYPE_PROVIDER } from "@/types";
import type { SearchResultItem } from "@/lib/web-search";

const fetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));
vi.mock("@/lib/storage/secret-store", () => ({
  getSecret: vi.fn(async (id: string) => `fixture-key-${id}`),
  secretKey: { aiProvider: (id: string) => id },
}));
vi.mock("@/lib", () => ({
  getResponseSettings: () => ({ language: "ru" }),
  LANGUAGES: [],
}));

const performWebSearchMock = vi.fn();
let webSearchEnabled = true;
vi.mock("@/lib/web-search", () => ({
  getWebSearchSettings: () => ({ enabled: webSearchEnabled, provider: "brave", maxResults: 3 }),
  performWebSearch: (...args: unknown[]) => performWebSearchMock(...args),
}));
vi.mock("../../web-search", () => ({
  getWebSearchSettings: () => ({ enabled: webSearchEnabled, provider: "brave", maxResults: 3 }),
  performWebSearch: (...args: unknown[]) => performWebSearchMock(...args),
}));
vi.mock("@/lib/rag", () => ({
  getRagContext: () => null,
  searchMemory: () => Promise.resolve([]),
}));
vi.mock("@/lib/host-trust-gate", () => ({
  resolveOutboundHeaders: async (_url: string, headers: Record<string, string>) => ({
    allowed: true,
    headers,
    maxRedirections: 0,
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: vi.fn(),
}));

import { fetchAIResponse } from "../ai-response.function";
import {
  getCachedSearchResults,
  resetSearchCacheForTests,
} from "../parallel-search";
const testProvider: TYPE_PROVIDER = {
  id: "test-provider",
  streaming: true,
  responseContentPath: "choices[0].delta.content",
  curl: `curl https://test.provider/v1/chat/completions -H 'Authorization: Bearer {{API_KEY}}' -d '{"model":"{{MODEL}}","messages":[{"role":"system","content":"{{SYSTEM_PROMPT}}"},{"role":"user","content":"{{TEXT}}"}]}'`,
};
const selectedProvider = {
  provider: "test-provider",
  variables: { MODEL: "test-model" },
};

interface OutboundRequestBody {
  messages?: Array<{ role: string; content: string }>;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sseResponse(chunks: string[]) {
  return {
    ok: true,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`
            )
          );
        }
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
  };
}

describe("R01: parallel web search overlap with LLM connect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    performWebSearchMock.mockReset();
    resetSearchCacheForTests();
    webSearchEnabled = true;
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts LLM connect before slow web search completes", async () => {
    const { promise: pendingSearchPromise, resolve: resolveSearch } =
      createDeferred<SearchResultItem[] | null>();
    performWebSearchMock.mockReturnValue(pendingSearchPromise);

    fetchMock.mockImplementation(() =>
      Promise.resolve(sseResponse(["hello ", "world"]))
    );

    const stream = fetchAIResponse({
      provider: testProvider,
      selectedProvider,
      userMessage: "Что такое React 19?",
    });

    const iterator = stream[Symbol.asyncIterator]();

    // Start consuming stream
    const firstChunkPromise = iterator.next();

    // Advance microtasks deterministically without waiting on web search
    await vi.advanceTimersByTimeAsync(10);

    // LLM connection MUST have started even though web search is still pending!
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Now resolve the search with late results
    resolveSearch([
      { title: "React 19 Release", url: "https://react.dev", snippet: "React 19 details" },
    ]);

    const firstChunk = await firstChunkPromise;
    expect(firstChunk.value).toBe("hello ");

    const secondChunk = await iterator.next();
    expect(secondChunk.value).toBe("world");

    await vi.advanceTimersByTimeAsync(10);

    // Late results must be cached for the next turn
    const cached = getCachedSearchResults("Что такое React 19?");
    expect(cached).not.toBeNull();
    expect(cached?.[0]?.title).toBe("React 19 Release");
  });

  it("caches late search results so the next turn uses them immediately", async () => {
    const { promise: pendingSearchPromise, resolve: resolveSearch } =
      createDeferred<SearchResultItem[] | null>();
    performWebSearchMock.mockReturnValue(pendingSearchPromise);

    fetchMock.mockImplementation(() =>
      Promise.resolve(sseResponse(["answer"]))
    );

    // Turn 1: search is slow
    const stream1 = fetchAIResponse({
      provider: testProvider,
      selectedProvider,
      userMessage: "Какая погода в Москве?",
    });
    const iter1 = stream1[Symbol.asyncIterator]();
    await iter1.next();

    // Late search resolves after first token
    resolveSearch([
      { title: "Погода", url: "https://weather.test", snippet: "+20C" },
    ]);
    await vi.advanceTimersByTimeAsync(10);

    // Turn 2: same query should now hit the cache
    performWebSearchMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(() =>
      Promise.resolve(sseResponse(["cached answer"]))
    );

    const stream2 = fetchAIResponse({
      provider: testProvider,
      selectedProvider,
      userMessage: "Какая погода в Москве?",
    });
    const iter2 = stream2[Symbol.asyncIterator]();
    await iter2.next();

    // In turn 2, web search was NOT performed again because it used cache
    expect(performWebSearchMock).not.toHaveBeenCalled();

    // And prompt sent to LLM should include the cached search block
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const lastCallInit = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
    const callBody = JSON.parse(lastCallInit?.body ?? "{}") as OutboundRequestBody;
    const systemPromptMessage = callBody.messages?.find(
      (m) => m.role === "system"
    );
    expect(systemPromptMessage?.content).toContain("[LIVE WEB SEARCH RESULTS");
    expect(systemPromptMessage?.content).toContain("Погода");
  });
});
