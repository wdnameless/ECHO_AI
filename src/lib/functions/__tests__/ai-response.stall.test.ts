import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReadableStream } from "node:stream/web";
import type { TYPE_PROVIDER } from "@/types";

const fetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...args: unknown[]) => fetchMock(...args) }));
vi.mock("@/lib/storage/secret-store", () => ({
  getSecret: vi.fn(async () => null), secretKey: { aiProvider: (id: string) => id },
}));
vi.mock("@/lib", () => ({ getResponseSettings: () => ({ language: "ru" }), LANGUAGES: [] }));
vi.mock("../web-search", () => ({ getWebSearchSettings: () => ({ enabled: false }) }));
vi.mock("@/lib/rag", () => ({ getRagContext: () => null }));
vi.mock("@/lib/host-trust-gate", () => ({
  resolveOutboundHeaders: async (_url: string, headers: Record<string, string>) => ({ allowed: true, headers, maxRedirections: 0 }),
}));
vi.mock("@tauri-apps/api/core", () => ({ Channel: class {}, invoke: vi.fn() }));
import { fetchAIResponse, type AIStreamEvent } from "../ai-response.function";

const provider: TYPE_PROVIDER = {
  id: "first", streaming: true, responseContentPath: "choices[0].delta.content",
  curl: `curl https://replay.test/stream -d '{"model":"first-model","messages":[{"role":"user","content":"{{TEXT}}"}]}'`,
};
const sse = (content: string) => new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);

beforeEach(() => { fetchMock.mockReset(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("stream stall ownership", () => {
  it.each([false, true])("keeps the original read through a stall (partial=%s)", async (partial) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c as unknown as ReadableStreamDefaultController<Uint8Array>; } });
    fetchMock.mockResolvedValue({ ok: true, body });
    const events: AIStreamEvent[] = [];
    const iterator = fetchAIResponse({ provider, selectedProvider: { provider: "first", variables: {} },
      allProviders: [provider, { ...provider, id: "second" }], userMessage: "Question", onEvent: (event) => events.push(event),
    })[Symbol.asyncIterator]();
    if (partial) {
      controller.enqueue(sse("first "));
      expect((await iterator.next()).value).toBe("first ");
    }
    const late = iterator.next();
    await vi.advanceTimersByTimeAsync(25_001);
    expect(events).toEqual([{ type: "attempt", providerId: "first" }, { type: "stalled", providerId: "first" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    controller.enqueue(sse("late"));
    controller.close();
    expect((await late).value).toBe("late");
    expect((await iterator.next()).done).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("settles an aborted wait even when native read and cancel never settle", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const nativeReader = body.getReader();
    // Tauri can leave BOTH promises pending; a browser stream alone settles read on cancel.
    fetchMock.mockResolvedValue({ ok: true, body: { getReader: () => ({
      read: () => nativeReader.read(), cancel,
    }) } });
    const ac = new AbortController();
    const onEvent = vi.fn();
    const iterator = fetchAIResponse({ provider, selectedProvider: { provider: "first", variables: {} },
      userMessage: "Question", signal: ac.signal, onEvent,
    })[Symbol.asyncIterator]();
    const waiting = iterator.next();
    await vi.advanceTimersByTimeAsync(25_001);
    ac.abort();
    expect((await waiting).done).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: "attempt", providerId: "first" }, { type: "stalled", providerId: "first" },
    ]);
    // Test-owned stream cleanup, not the deliberately hung native cancellation.
    nativeReader.releaseLock();
  });
});
