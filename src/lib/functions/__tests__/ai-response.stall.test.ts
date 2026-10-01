import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TYPE_PROVIDER } from "@/types";

const fetchMock = vi.fn();
const raceStallMock = vi.fn();

vi.mock("@/lib/storage/secret-store", () => ({
  getSecret: vi.fn(async () => "sk-from-store"),
  saveSecret: vi.fn(),
  removeSecret: vi.fn(),
  secretKey: { aiProvider: (id: string) => `ai-provider:${id}` },
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

vi.mock("@/lib", () => ({
  getResponseSettings: () => ({ length: "short", language: "ru" }),
  RESPONSE_LENGTHS: [{ id: "short", label: "Short", prompt: "" }],
  LANGUAGES: [{ id: "ru", label: "Russian" }],
}));

vi.mock("../web-search", () => ({
  getWebSearchSettings: () => ({ enabled: false }),
  performWebSearch: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/host-trust-gate", () => ({
  resolveOutboundHeaders: async (
    _url: string,
    headers: Record<string, string>
  ) => ({
    allowed: true,
    headers,
  }),
}));

vi.mock("@/lib/rag", () => ({ getRagContext: () => "" }));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((msg: unknown) => void) | null = null;
  },
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../stall-guard", () => ({
  raceStall: (...args: unknown[]) => raceStallMock(...args),
}));

import {
  fetchAIResponse,
  isFailureChunk,
  STALL_SENTINEL,
} from "../ai-response.function";

const STREAMING_PROVIDER_1: TYPE_PROVIDER = {
  id: "provider-1",
  name: "Provider 1",
  curl: `curl https://api.example.test/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model": "m1", "messages": [{"role": "user", "content": "{{TEXT}}"}]}'`,
  responseContentPath: "choices[0].delta.content",
  streaming: true,
} as TYPE_PROVIDER;

const STREAMING_PROVIDER_2: TYPE_PROVIDER = {
  id: "provider-2",
  name: "Provider 2",
  curl: `curl https://api.example.test/v2/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model": "m2", "messages": [{"role": "user", "content": "{{TEXT}}"}]}'`,
  responseContentPath: "choices[0].delta.content",
  streaming: true,
} as TYPE_PROVIDER;

beforeEach(() => {
  fetchMock.mockReset();
  raceStallMock.mockReset();
});

describe("P5 STALL manual resolve", () => {
  it("excludes STALL_SENTINEL explicitly from isFailureChunk", () => {
    expect(isFailureChunk(STALL_SENTINEL)).toBe(false);
    expect(STALL_SENTINEL).toBe("__ECHO_STALL__");
  });

  it("yields STALL_SENTINEL instead of error text on stall, and P4 forwards sentinel without fallback/exhaustion", async () => {
    // raceStall rejects with STALL on the first read
    raceStallMock.mockRejectedValueOnce(new Error("STALL"));

    const encoder = new TextEncoder();
    const readerMock = {
      read: vi
        .fn()
        // First read stalls (pending promise passed to raceStall)
        .mockReturnValueOnce(new Promise(() => {}))
        // Second read (unbounded) resolves with late content
        .mockResolvedValueOnce({
          done: false,
          value: encoder.encode(
            'data: {"choices":[{"delta":{"content":"late content"}}]}\n\n'
          ),
        })
        .mockResolvedValueOnce({ done: true }),
      cancel: vi.fn(),
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        getReader: () => readerMock,
      },
    });

    const chunks: string[] = [];
    const iterator = fetchAIResponse({
      provider: STREAMING_PROVIDER_1,
      selectedProvider: {
        provider: "provider-1",
        variables: {},
      },
      allProviders: [STREAMING_PROVIDER_1, STREAMING_PROVIDER_2],
      userMessage: "Hello",
    });

    for await (const chunk of iterator) {
      chunks.push(chunk);
    }

    // Must yield STALL_SENTINEL first, followed by the late content
    expect(chunks).toEqual([STALL_SENTINEL, "late content"]);
    // Must NOT contain error text
    expect(chunks.some((c) => c.includes("Провайдер не ответил"))).toBe(false);
    // P4 must NOT fall back to provider-2: fetchMock called only once for provider-1
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // reader.cancel must not be called during stall wait
    expect(readerMock.cancel).not.toHaveBeenCalled();
  });

  it("delivers late content on mid-stream stall without clobbering stream", async () => {
    const encoder = new TextEncoder();
    // First read passes through raceStall
    raceStallMock.mockImplementationOnce((p: Promise<unknown>) => p);
    // Second read stalls
    raceStallMock.mockRejectedValueOnce(new Error("STALL"));

    const readerMock = {
      read: vi
        .fn()
        // First read delivers first chunk
        .mockResolvedValueOnce({
          done: false,
          value: encoder.encode(
            'data: {"choices":[{"delta":{"content":"first chunk"}}]}\n\n'
          ),
        })
        // Second read stalls (pending promise passed to raceStall)
        .mockReturnValueOnce(new Promise(() => {}))
        // Third read (unbounded, direct reader.read) delivers second content
        .mockResolvedValueOnce({
          done: false,
          value: encoder.encode(
            'data: {"choices":[{"delta":{"content":" second chunk"}}]}\n\n'
          ),
        })
        .mockResolvedValueOnce({ done: true }),
      cancel: vi.fn(),
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        getReader: () => readerMock,
      },
    });

    const chunks: string[] = [];
    for await (const chunk of fetchAIResponse({
      provider: STREAMING_PROVIDER_1,
      selectedProvider: {
        provider: "provider-1",
        variables: {},
      },
      userMessage: "Hi",
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["first chunk", STALL_SENTINEL, " second chunk"]);
    expect(readerMock.cancel).not.toHaveBeenCalled();
  });

  it("closes reader immediately when abort signal is triggered during stall wait", async () => {
    raceStallMock.mockRejectedValueOnce(new Error("STALL"));

    const abortController = new AbortController();
    const readerMock = {
      read: vi.fn().mockImplementation(() => {
        // Pending unbounded read
        return new Promise(() => {});
      }),
      cancel: vi.fn(),
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        getReader: () => readerMock,
      },
    });

    const iterator = fetchAIResponse({
      provider: STREAMING_PROVIDER_1,
      selectedProvider: {
        provider: "provider-1",
        variables: {},
      },
      userMessage: "Hi",
      signal: abortController.signal,
    })[Symbol.asyncIterator]();

    // Consume the sentinel
    const first = await iterator.next();
    expect(first.value).toBe(STALL_SENTINEL);

    // Abort should trigger reader.cancel
    abortController.abort();
    expect(readerMock.cancel).toHaveBeenCalled();
  });
});
