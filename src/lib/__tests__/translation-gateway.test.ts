import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The translation column showed a dash for every row: no provider worked from
 * inside the app.
 *
 * Why the free endpoints cannot be used here is measured, not guessed: the
 * WebView's own `fetch` is blocked by the app's CSP (`connect-src` allows only
 * `'self'` and loopback — the console reports «Connecting to
 * 'https://translate.googleapis.com/…' violates the Content Security Policy»),
 * and the HTTP plugin, the only remaining path, does not present a browser
 * profile, so those endpoints answer 429 to it while the same URL answers 200
 * from Node.
 *
 * The project gateway is the one host this app already reaches for every AI
 * answer, with the same plugin, so it is the translation path that is known to
 * work. These tests pin the contract that matters: it is used LAST, and it
 * never hands back the source text as if it were a translation.
 */

const tauriFetchMock = vi.fn();
const getSecretMock = vi.fn();

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => tauriFetchMock(...args),
}));

vi.mock("../storage/secret-store", () => ({
  getSecret: (...args: unknown[]) => getSecretMock(...args),
  secretKey: { aiProvider: (id: string) => `ai_provider:${id}:API_KEY` },
}));

let fastTranslate: typeof import("../fast-translator").fastTranslate;

beforeEach(async () => {
  vi.resetModules();
  tauriFetchMock.mockReset();
  getSecretMock.mockReset();
  getSecretMock.mockResolvedValue(null);
  ({ fastTranslate } = await import("../fast-translator"));
});

/** A gateway reply in the shape the endpoint returns. */
function gatewayReply(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

describe("translation falls back to the project gateway", () => {
  it("uses the gateway when the free endpoints fail", async () => {
    // GTX: not ok. MyMemory: not ok. Gateway: a translation.
    tauriFetchMock.mockImplementation((url: string) => {
      if (url.includes("ai-gateway")) return Promise.resolve(gatewayReply("Yes, exactly."));
      return Promise.resolve({ ok: false, status: 429, json: async () => ({}) });
    });

    const out = await fastTranslate("Так, точно.", "en");
    expect(out).toBe("Yes, exactly.");
    // and it was the gateway that answered
    expect(tauriFetchMock.mock.calls.some((c) => String(c[0]).includes("ai-gateway"))).toBe(true);
  });

  it("strips the wrappers a chat model adds despite the instruction", async () => {
    tauriFetchMock.mockImplementation((url: string) =>
      url.includes("ai-gateway")
        ? Promise.resolve(gatewayReply('```\n"Well, I suggest we request reinforcement first."\n```'))
        : Promise.resolve({ ok: false, status: 429, json: async () => ({}) })
    );

    const out = await fastTranslate("Что ж, предлагаю сперва запросить подкрепление.", "en");
    expect(out).toBe("Well, I suggest we request reinforcement first.");
  });

  it("never returns the source text as its own translation", async () => {
    // The gateway echoing the input is a failure, not a translation.
    tauriFetchMock.mockImplementation((url: string) =>
      url.includes("ai-gateway")
        ? Promise.resolve(gatewayReply("Так, точно."))
        : Promise.resolve({ ok: false, status: 429, json: async () => ({}) })
    );

    const out = await fastTranslate("Так, точно.", "en");
    // Falls through to the unchanged input, which the caller treats as a failure
    // and shows as a dash rather than storing it.
    expect(out).toBe("Так, точно.");
  });

  it("sends the saved gateway key when there is one", async () => {
    getSecretMock.mockResolvedValue("test-key");
    tauriFetchMock.mockImplementation((url: string) =>
      url.includes("ai-gateway")
        ? Promise.resolve(gatewayReply("Yes, exactly."))
        : Promise.resolve({ ok: false, status: 429, json: async () => ({}) })
    );

    await fastTranslate("Так, точно.", "en");
    const call = tauriFetchMock.mock.calls.find((c) => String(c[0]).includes("ai-gateway"));
    expect(call).toBeDefined();
    const init = call![1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer test-key");
  });

  it("does not require a key: this gateway answers unauthenticated too", async () => {
    getSecretMock.mockResolvedValue(null);
    tauriFetchMock.mockImplementation((url: string) =>
      url.includes("ai-gateway")
        ? Promise.resolve(gatewayReply("Yes, exactly."))
        : Promise.resolve({ ok: false, status: 429, json: async () => ({}) })
    );

    const out = await fastTranslate("Так, точно.", "en");
    expect(out).toBe("Yes, exactly.");
    const call = tauriFetchMock.mock.calls.find((c) => String(c[0]).includes("ai-gateway"));
    const init = call![1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("does not touch the gateway when a fast provider already answered", async () => {
    // GTX answers: the slow, token-costing path must not be used at all.
    tauriFetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          url.includes("translate.googleapis")
            ? [[["Yes, exactly.", "Так, точно.", null, null, 3]]]
            : { choices: [{ message: { content: "SHOULD NOT BE USED" } }] },
      })
    );

    const out = await fastTranslate("Так, точно.", "en");
    expect(out).toBe("Yes, exactly.");
    expect(tauriFetchMock.mock.calls.some((c) => String(c[0]).includes("ai-gateway"))).toBe(false);
  });
});
