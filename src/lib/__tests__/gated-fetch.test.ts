import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { gatedFetch, warmProviderConnection, setHostTrustPrompt, resetHostTrustPromptForTests } from "../host-trust-gate";
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

  it.each(["query", "body", "form"])("never invokes transport for %s credentials declined without-secrets", async (kind) => {
    setHostTrustPrompt(async () => "without-secrets");
    const spy = vi.fn().mockResolvedValue(okResponse);
    const form = new FormData();
    form.append("api_key", "dummy-form");
    const url = `https://unknown.example/v1${kind === "query" ? "?api_key=dummy-query" : ""}`;
    const body = kind === "form" ? form : kind === "body" ? '{"api_key":"dummy-body"}' : null;
    await expect(gatedFetch(url, { method: "POST", body }, spy)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends benign message text unchanged, without header credentials", async () => {
    setHostTrustPrompt(async () => "without-secrets");
    const spy = vi.fn().mockResolvedValue(okResponse);
    const body = '{"messages":[{"content":"Explain api_key"}],"max_tokens":20}';
    await gatedFetch("https://unknown.example/v1", {
      method: "POST", body, headers: { Authorization: "Bearer dummy", Accept: "application/json" },
    }, spy);
    expect(spy).toHaveBeenCalledWith("https://unknown.example/v1", expect.objectContaining({
      body, headers: { Accept: "application/json" }, maxRedirections: 0, redirect: "error",
    }));
  });

  it.each(["deny", "no-handler"])("makes no warmup network request on %s", async (decision) => {
    if (decision === "deny") setHostTrustPrompt(async () => "deny");
    const spy = vi.fn().mockResolvedValue(okResponse);
    await expect(warmProviderConnection("https://unknown.example/v1?api_key=dummy", spy)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("warms an approved credential-free origin, not the configured credential URL", async () => {
    const prompt = vi.fn(async () => "without-secrets" as const);
    setHostTrustPrompt(prompt);
    const spy = vi.fn().mockResolvedValue(okResponse);
    await warmProviderConnection("https://dummy-user:dummy-password@unknown.example:8443/v1?api_key=dummy#fragment", spy);
    expect(prompt).toHaveBeenCalledWith({ host: "unknown.example", secrets: [] });
    expect(spy).toHaveBeenCalledWith("https://unknown.example:8443/", expect.objectContaining({
      method: "GET", headers: {}, body: undefined, signal: expect.any(AbortSignal),
      maxRedirections: 0, redirect: "error",
    }));
  });

  it("aborts warmup transport at 1500ms", async () => {
    vi.useFakeTimers();
    try {
      setHostTrustPrompt(async () => "without-secrets");
      const spy = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }));
      const pending = warmProviderConnection("https://unknown.example/v1", spy);
      const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(1499);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][1]!.signal!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
      expect(spy.mock.calls[0][1]!.signal!.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
