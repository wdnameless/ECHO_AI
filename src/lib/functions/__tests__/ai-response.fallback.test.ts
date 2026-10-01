import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TYPE_PROVIDER } from "@/types";

const fetchMock = vi.fn();

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
    headers: Object.fromEntries(
      Object.entries(headers).filter(
        ([name]) => name.toLowerCase() !== "authorization"
      )
    ),
  }),
}));

vi.mock("@/lib/rag", () => ({ getRagContext: () => "" }));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((msg: unknown) => void) | null = null;
  },
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { fetchAIResponse } from "../ai-response.function";

const PROVIDER_A: TYPE_PROVIDER = {
  id: "provider-a",
  name: "Provider A",
  curl: `curl https://api.a.test/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{"model": "{{MODEL}}", "messages": [{"role": "user", "content": "{{TEXT}}"}]}'`,
  responseContentPath: "choices[0].message.content",
  streaming: false,
} as TYPE_PROVIDER;

const PROVIDER_B: TYPE_PROVIDER = {
  id: "provider-b",
  name: "Provider B",
  curl: `curl https://api.b.test/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{"model": "{{MODEL}}", "messages": [{"role": "user", "content": "{{TEXT}}"}]}'`,
  responseContentPath: "choices[0].message.content",
  streaming: false,
} as TYPE_PROVIDER;

const PROVIDER_C: TYPE_PROVIDER = {
  id: "provider-c",
  name: "Provider C",
  curl: `curl https://api.c.test/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{"model": "{{MODEL}}", "messages": [{"role": "user", "content": "{{TEXT}}"}]}'`,
  responseContentPath: "choices[0].message.content",
  streaming: false,
} as TYPE_PROVIDER;

beforeEach(() => {
  fetchMock.mockReset();
});

describe("provider fallback chain", () => {
  it("first 429 → second provider called and its content returned", async () => {
    // Provider A fails with 429 on initial attempt
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "rate limit A",
      headers: new Map(),
      body: null,
    });
    // Provider A inner retry also fails with 429
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "rate limit A retry",
      headers: new Map(),
      body: null,
    });
    // Provider B succeeds
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "content from B" } }],
      }),
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: "content from B" } }],
        }),
      headers: new Map(),
      body: null,
    });

    const chunks: string[] = [];
    for await (const chunk of fetchAIResponse({
      provider: PROVIDER_A,
      selectedProvider: {
        provider: "provider-a",
        variables: { MODEL: "test-model", API_KEY: "sk-a" },
      },
      allProviders: [PROVIDER_A, PROVIDER_B],
      userMessage: "привет",
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      "(переключаю на provider-b…)",
      "content from B",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain("api.a.test");
    expect(fetchMock.mock.calls[1][0]).toContain("api.a.test");
    expect(fetchMock.mock.calls[2][0]).toContain("api.b.test");
  });

  it("network-error chunk → fallback", async () => {
    // Provider A fails with network error
    fetchMock.mockRejectedValueOnce(new Error("Connection refused"));
    // Provider B succeeds
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "content from B" } }],
      }),
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: "content from B" } }],
        }),
      headers: new Map(),
      body: null,
    });

    const chunks: string[] = [];
    for await (const chunk of fetchAIResponse({
      provider: PROVIDER_A,
      selectedProvider: {
        provider: "provider-a",
        variables: { MODEL: "test-model", API_KEY: "sk-a" },
      },
      allProviders: [PROVIDER_A, PROVIDER_B],
      userMessage: "привет",
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      "(переключаю на provider-b…)",
      "content from B",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("api.a.test");
    expect(fetchMock.mock.calls[1][0]).toContain("api.b.test");
  });

  it("order = selected first, no dupes", async () => {
    // Provider A fails
    fetchMock.mockRejectedValueOnce(new Error("Network fail A"));
    // Provider B fails
    fetchMock.mockRejectedValueOnce(new Error("Network fail B"));
    // Provider C succeeds
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "content from C" } }],
      }),
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: "content from C" } }],
        }),
      headers: new Map(),
      body: null,
    });

    const chunks: string[] = [];
    for await (const chunk of fetchAIResponse({
      provider: PROVIDER_A,
      selectedProvider: {
        provider: "provider-a",
        variables: { MODEL: "test-model", API_KEY: "sk-a" },
      },
      allProviders: [PROVIDER_B, PROVIDER_A, PROVIDER_C, PROVIDER_B],
      userMessage: "привет",
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      "(переключаю на provider-b…)",
      "(переключаю на provider-c…)",
      "content from C",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain("api.a.test");
    expect(fetchMock.mock.calls[1][0]).toContain("api.b.test");
    expect(fetchMock.mock.calls[2][0]).toContain("api.c.test");
  });

  it("exhaustion throw names all tried + last error", async () => {
    // Provider A fails with network error
    fetchMock.mockRejectedValueOnce(new Error("Net error A"));
    // Provider B fails with 500
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "crash B",
      headers: new Map(),
      body: null,
    });

    const run = async () => {
      for await (const _ of fetchAIResponse({
        provider: PROVIDER_A,
        selectedProvider: {
          provider: "provider-a",
          variables: { MODEL: "test-model", API_KEY: "sk-a" },
        },
        allProviders: [PROVIDER_A, PROVIDER_B],
        userMessage: "привет",
      })) {
        // iterate
      }
    };

    await expect(run()).rejects.toThrow(
      "Все провайдеры недоступны (пробовали: provider-a, provider-b): API request failed: 500 Internal Server Error - crash B"
    );
  });

  it("single-provider call without allProviders behaves as before", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "single provider ok" } }],
      }),
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: "single provider ok" } }],
        }),
      headers: new Map(),
      body: null,
    });

    const chunks: string[] = [];
    for await (const chunk of fetchAIResponse({
      provider: PROVIDER_A,
      selectedProvider: {
        provider: "provider-a",
        variables: { MODEL: "test-model", API_KEY: "sk-a" },
      },
      userMessage: "привет",
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("single provider ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("api.a.test");
  });

  it("silently returns on abort without fallback or throwing", async () => {
    const ac = new AbortController();
    ac.abort();

    const chunks: string[] = [];
    for await (const chunk of fetchAIResponse({
      provider: PROVIDER_A,
      selectedProvider: {
        provider: "provider-a",
        variables: { MODEL: "test-model", API_KEY: "sk-a" },
      },
      allProviders: [PROVIDER_A, PROVIDER_B],
      userMessage: "привет",
      signal: ac.signal,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
