import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { gatedFetch, setHostTrustPrompt, resetHostTrustPromptForTests } from "../host-trust-gate";
import { STORAGE_KEYS } from "@/config/constants";
import { isBuiltInServiceHost } from "../trusted-hosts";

/**
 * Every outbound call must pass the gate.
 *
 * The gate was invoked by only three of six network modules: web-search,
 * the translator and the settings "Test" button went straight to the Tauri
 * HTTP plugin with credentials attached and no redirect limit, while
 * `capabilities` allow `http://**` and `https://**` — so the gate is the only
 * egress control and it was being bypassed. `gatedFetch` is the single path now,
 * and these tests pin the properties that make it worth having.
 */
const okResponse = { ok: true, status: 200 } as Response;

beforeEach(() => {
  localStorage.clear();
  resetHostTrustPromptForTests();
});

afterEach(() => {
  resetHostTrustPromptForTests();
});

describe("gatedFetch", () => {
  it("refuses an untrusted host when nobody can confirm (fail closed)", async () => {
    const spy = vi.fn().mockResolvedValue(okResponse);
    await expect(
      gatedFetch("https://evil.example/collect", {}, spy)
    ).rejects.toThrow("хост не входит в список доверенных");
    // The request must not leave at all — that is the whole point.
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends to a built-in service host without prompting", async () => {
    let prompted = false;
    setHostTrustPrompt(async () => {
      prompted = true;
      return "deny";
    });
    const spy = vi.fn().mockResolvedValue(okResponse);

    await gatedFetch("https://api.search.brave.com/res/v1/web/search?q=x", {}, spy);

    expect(prompted).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("carries maxRedirections: 0, so a 30x cannot move the key to another host", async () => {
    const spy = vi.fn().mockResolvedValue(okResponse);
    await gatedFetch("https://api.tavily.com/search", {}, spy);

    const init = spy.mock.calls[0][1] as { maxRedirections?: number };
    expect(init.maxRedirections).toBe(0);
  });

  it("lets the user approve an unknown host once, then remembers it", async () => {
    setHostTrustPrompt(async () => "trust");
    const spy = vi.fn().mockResolvedValue(okResponse);

    await gatedFetch("https://my-llm.internal/v1/chat", {}, spy);
    expect(spy).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.TRUSTED_HOSTS) || "[]")).toContain(
      "my-llm.internal"
    );
  });

  it("strips credentials when the user declines to share the key", async () => {
    setHostTrustPrompt(async () => "without-secrets");
    const spy = vi.fn().mockResolvedValue(okResponse);

    await gatedFetch(
      "https://unknown.example/v1",
      { headers: { Authorization: "Bearer secret", Accept: "application/json" } },
      spy
    );

    const init = spy.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers.Accept).toBe("application/json");
  });

  it("only the app's own endpoints are built in — not arbitrary hosts", () => {
    expect(isBuiltInServiceHost("https://api.search.brave.com/x")).toBe(true);
    expect(isBuiltInServiceHost("https://api.exa.ai/search")).toBe(true);
    expect(isBuiltInServiceHost("https://translate.googleapis.com/x")).toBe(true);
    // The important half: this list must not become a blanket bypass.
    expect(isBuiltInServiceHost("https://evil.example/x")).toBe(false);
    expect(isBuiltInServiceHost("https://api.openai.com.evil.example/x")).toBe(false);
  });
});
