import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TYPE_PROVIDER } from "@/types";

/**
 * The retry that fires on a transient gateway error must reuse the headers the
 * host-trust gate approved, not the raw ones.
 *
 * When the user declines to send credentials to an unfamiliar host, the gate
 * returns a sanitized copy for exactly that case. The retry used the raw map, so
 * a single 502 re-attached the API key the user had just refused to send — the
 * whole point of the gate, undone by one automatic retry.
 */
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

// The gate strips the secret header and reports the host as allowed — the
// "без ключа" branch a user picks when they do not trust the host.
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

const authOf = (call: unknown[] | undefined) => {
  const init = (call?.[1] ?? {}) as { headers?: Record<string, string> };
  const headers = init.headers ?? {};
  return Object.entries(headers).find(
    ([k]) => k.toLowerCase() === "authorization"
  )?.[1];
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("transient-gateway retry and the host-trust gate", () => {
  it("never re-attaches a stripped credential on the retry", async () => {
    // First attempt: the gateway fails transiently. Retry: succeeds.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: async () => "upstream",
      headers: new Map(),
      body: null,
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      headers: new Map(),
      body: null,
    });

    const iterator = fetchAIResponse({
      provider: PROVIDER,
      selectedProvider: {
        provider: "custom-test",
        variables: { MODEL: "test-model", API_KEY: "sk-explicit" },
      },
      userMessage: "привет",
    })[Symbol.asyncIterator]();
    await iterator.next();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(fetchMock.mock.calls[0])).toBeUndefined();
    // The retry must match the first attempt: no credential.
    expect(authOf(fetchMock.mock.calls[1])).toBeUndefined();
  });
});
