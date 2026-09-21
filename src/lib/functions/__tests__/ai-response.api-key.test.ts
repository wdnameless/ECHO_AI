import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TYPE_PROVIDER } from "@/types";

/**
 * The pipeline used to reject a request with «Не настроен API-ключ» whenever the
 * key was absent from the provider's *variables*, even though the key lives in the
 * OS secure store after the S4 migration. The secure-store lookup ran only after
 * that validation, so the fallback could never fire. These tests pin the order:
 * validation must see the stored key.
 */
const getSecretMock = vi.fn<(key: string) => Promise<string | null>>();
const fetchMock = vi.fn();

vi.mock("@/lib/storage/secret-store", () => ({
  getSecret: (key: string) => getSecretMock(key),
  saveSecret: vi.fn(),
  removeSecret: vi.fn(),
  secretKey: { aiProvider: (id: string) => `ai-provider:${id}` },
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

// `@/lib` re-exports the pipeline itself, which makes the real barrel a cycle
// inside a test process. The pipeline only reads settings from it, so a stub keeps
// the module graph acyclic.
vi.mock("@/lib", () => ({
  getResponseSettings: () => ({ length: "short", language: "ru" }),
  RESPONSE_LENGTHS: [{ id: "short", label: "Short", prompt: "" }],
  LANGUAGES: [{ id: "ru", label: "Russian" }],
}));

vi.mock("../web-search", () => ({
  getWebSearchSettings: () => ({ enabled: false }),
  performWebSearch: vi.fn().mockResolvedValue([]),
}));

// The S2 host-trust gate blocks unknown hosts in tests; the assertions here are
// about credentials, not about the trust list.
vi.mock("@/lib/host-trust-gate", () => ({
  resolveOutboundHeaders: async (_url: string, headers: Record<string, string>) => ({
    allowed: true,
    headers,
  }),
}));

vi.mock("@/lib/rag", () => ({
  getRagContext: () => "",
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((msg: unknown) => void) | null = null;
  },
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { describeHttpFailure, fetchAIResponse } from "../ai-response.function";

const PROVIDER: TYPE_PROVIDER = {
  id: "custom-test",
  name: "Custom Test",
  curl: `curl https://api.example.test/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{"model": "{{MODEL}}", "messages": [{"role": "user", "content": "{{TEXT}}"}]}'`,
  responseContentPath: "choices[0].message.content",
  streaming: false,
} as TYPE_PROVIDER;

/** Pulls one chunk so the generator actually runs up to the outgoing request. */
async function run(params: Parameters<typeof fetchAIResponse>[0]) {
  const iterator = fetchAIResponse(params)[Symbol.asyncIterator]();
  return iterator.next();
}

beforeEach(() => {
  getSecretMock.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
    headers: new Map(),
    body: null,
  });
});

describe("fetchAIResponse API key resolution", () => {
  it("uses the key from the secure store when provider variables hold none", async () => {
    getSecretMock.mockResolvedValue("sk-from-secure-store");

    await expect(
      run({
        provider: PROVIDER,
        selectedProvider: { provider: "custom-test", variables: { MODEL: "test-model" } },
        userMessage: "привет",
      })
    ).resolves.toBeDefined();

    const [, init] = fetchMock.mock.calls[0] as [string, { headers?: Record<string, string> }];
    const headers = init?.headers ?? {};
    const auth = Object.entries(headers).find(
      ([k]) => k.toLowerCase() === "authorization"
    )?.[1];
    expect(auth).toBe("Bearer sk-from-secure-store");
  });

  it("still reports a missing key when neither variables nor the store have one", async () => {
    getSecretMock.mockResolvedValue(null);

    await expect(
      run({
        provider: PROVIDER,
        selectedProvider: { provider: "custom-test", variables: { MODEL: "test-model" } },
        userMessage: "привет",
      })
    ).rejects.toThrow(/Не настроен API-ключ/);
  });

  it("prefers an explicitly configured key over the stored one", async () => {
    getSecretMock.mockResolvedValue("sk-stale");

    await run({
      provider: PROVIDER,
      selectedProvider: {
        provider: "custom-test",
        variables: { MODEL: "test-model", API_KEY: "sk-explicit" },
      },
      userMessage: "привет",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, { headers?: Record<string, string> }];
    const headers = init?.headers ?? {};
    const auth = Object.entries(headers).find(
      ([k]) => k.toLowerCase() === "authorization"
    )?.[1];
    expect(auth).toBe("Bearer sk-explicit");
  });
});

describe("describeHttpFailure", () => {
  it("explains a Cloudflare tunnel outage instead of echoing the raw code", () => {
    const message = describeHttpFailure(530, "error", "error code: 1033");

    expect(message).toContain("туннель Cloudflare");
    expect(message).toContain("на стороне провайдера");
    // The raw text still has to be there for anyone debugging the provider.
    expect(message).toContain("error code: 1033");
  });

  it("points at the key when the provider rejects credentials", () => {
    expect(describeHttpFailure(401, "Unauthorized", "")).toContain(
      "Проверьте API-ключ"
    );
  });

  it("keeps unrecognised failures in their original shape", () => {
    expect(describeHttpFailure(500, "Internal Server Error", "boom")).toBe(
      "API request failed: 500 Internal Server Error - boom"
    );
  });
});
