import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReadableStream } from "node:stream/web";
import type { TYPE_PROVIDER } from "@/types";

const fetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...args: unknown[]) => fetchMock(...args) }));
vi.mock("@/lib/storage/secret-store", () => ({
  getSecret: vi.fn(async (id: string) => `fixture-key-${id}`), secretKey: { aiProvider: (id: string) => id },
}));
vi.mock("@/lib", () => ({ getResponseSettings: () => ({ language: "ru" }), LANGUAGES: [] }));
vi.mock("../web-search", () => ({ getWebSearchSettings: () => ({ enabled: false }) }));
vi.mock("@/lib/rag", () => ({ getRagContext: () => null }));
vi.mock("@/lib/host-trust-gate", () => ({
  resolveOutboundHeaders: async (_url: string, headers: Record<string, string>) => ({ allowed: true, headers, maxRedirections: 0 }),
}));
vi.mock("@tauri-apps/api/core", () => ({ Channel: class {}, invoke: vi.fn() }));
import { fetchAIResponse, type AIStreamEvent } from "../ai-response.function";
import { setAIProviderVariables } from "@/lib/storage/ai-providers";

const providers: TYPE_PROVIDER[] = ["a", "b", "c"].map((id) => ({
  id, streaming: true, responseContentPath: "choices[0].delta.content",
  curl: `curl https://${id}.test/stream -H 'Authorization: Bearer {{API_KEY}}' -d '{"model":"{{MODEL}}","reasoning_effort":"{{REASONING_EFFORT}}","messages":[{"role":"user","content":"{{TEXT}}"}]}'`,
}));
const selectedProvider = { provider: "a", variables: { MODEL: "model-a", REASONING_EFFORT: "high" } };
function response(content: string) {
  return { ok: true, body: new ReadableStream<Uint8Array>({ start(c) {
    c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
    c.close();
  } }) };
}
async function collect(allProviders = providers) {
  let text = "";
  const events: AIStreamEvent[] = [];
  for await (const chunk of fetchAIResponse({ provider: providers[0], selectedProvider, allProviders,
    userMessage: "Question", onEvent: (event) => { events.push(event); if (event.type === "restart") text = ""; },
  })) text += chunk;
  return { text, events };
}
beforeEach(() => {
  fetchMock.mockReset(); localStorage.clear();
  setAIProviderVariables("b", { MODEL: "model-b", REASONING_EFFORT: "low" });
  setAIProviderVariables("c", { MODEL: "model-c" });
});

describe("provider fallback ownership", () => {
  it("starts selected first, skips duplicates, and sends each model/key/config only to its owner", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline a")).mockRejectedValueOnce(new Error("offline b")).mockResolvedValueOnce(response("answer c"));
    const result = await collect([providers[1], providers[0], providers[2], providers[1]]);
    expect(result.text).toBe("answer c");
    expect(result.events).toEqual([
      { type: "attempt", providerId: "a" }, { type: "restart", providerId: "b" },
      { type: "attempt", providerId: "b" }, { type: "restart", providerId: "c" }, { type: "attempt", providerId: "c" },
    ]);
    expect(fetchMock.mock.calls.map(([url, init]) => ({
      url, model: JSON.parse(init.body).model, reasoning: JSON.parse(init.body).reasoning_effort,
      key: init.headers.Authorization,
    }))).toEqual([
      { url: "https://a.test/stream", model: "model-a", reasoning: "high", key: "Bearer fixture-key-a" },
      { url: "https://b.test/stream", model: "model-b", reasoning: "low", key: "Bearer fixture-key-b" },
      { url: "https://c.test/stream", model: "model-c", reasoning: "minimal", key: "Bearer fixture-key-c" },
    ]);
  });

  it.each(["transport", "provider", "malformed"])("replaces partial output after a %s error", async (failure) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    fetchMock.mockResolvedValueOnce({ ok: true, body: new ReadableStream<Uint8Array>({ start(c) {
      controller = c as unknown as ReadableStreamDefaultController<Uint8Array>;
      c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"broken partial"}}]}\n\n'));
    } }) }).mockResolvedValueOnce(response("replacement"));
    let text = "";
    const events: AIStreamEvent[] = [];
    for await (const chunk of fetchAIResponse({ provider: providers[0], selectedProvider, allProviders: providers,
      userMessage: "Question", onEvent: (event) => { events.push(event); if (event.type === "restart") text = ""; },
    })) {
      text += chunk;
      if (text === "broken partial") {
        if (failure === "transport") controller.error(new Error("disconnected"));
        else {
          controller.enqueue(new TextEncoder().encode(failure === "malformed" ? "data: not-json\n\n" :
            'data: {"error":{"message":"provider rejected mid-stream"}}\n\n'));
          controller.close();
        }
      }
    }
    expect(text).toBe("replacement");
    expect(events).toContainEqual({ type: "restart", providerId: "b" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never classifies legitimate answer text as an error", async () => {
    fetchMock.mockResolvedValueOnce(response("Network error is the subject of this explanation"));
    expect((await collect()).text).toBe("Network error is the subject of this explanation");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the fallback template model when that provider has no saved variables", async () => {
    const fallback = { ...providers[1], curl: providers[1].curl.replace("{{MODEL}}", "template-b") };
    setAIProviderVariables("b", {});
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response("template answer"));
    expect((await collect([providers[0], fallback])).text).toBe("template answer");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe("template-b");
  });

  it("uses the fallback's persisted token budgets and secure key instead of discarded credentials", async () => {
    const fallback = {
      ...providers[1],
      curl: providers[1].curl.replace('"reasoning_effort":"{{REASONING_EFFORT}}"',
        '"reasoning_effort":"{{REASONING_EFFORT}}","max_tokens":"{{MAX_TOKENS}}","max_output_tokens":"{{MAX_OUTPUT_TOKENS}}","token_budget":"{{TOKEN_BUDGET}}"'),
    };
    setAIProviderVariables("b", {
      MODEL: "budget-model", MAX_TOKENS: "512", MAX_OUTPUT_TOKENS: "1024", TOKEN_BUDGET: "64",
      API_KEY: "discarded-credential", KEY: "discarded-credential", AUTH: "discarded-credential", SESSION_ID: "discarded-credential",
    });
    fetchMock.mockRejectedValueOnce(new Error("primary offline")).mockResolvedValueOnce(response("budget answer"));
    expect((await collect([providers[0], fallback])).text).toBe("budget answer");
    const request = fetchMock.mock.calls[1][1];
    expect(JSON.parse(request.body)).toMatchObject({
      model: "budget-model", max_tokens: "512", max_output_tokens: "1024", token_budget: "64",
    });
    expect(request.headers.Authorization).toBe("Bearer fixture-key-b");
  });
  it("throws after every candidate fails, even after partial text", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline a")).mockRejectedValueOnce(new Error("offline b")).mockRejectedValueOnce(new Error("offline c"));
    await expect(collect()).rejects.toThrow(/a, b, c/);
  });
});
