import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveOutboundHeaders,
  resolveRedirect,
  listSecretHeaders,
  setHostTrustPrompt,
  resetHostTrustPromptForTests,
  type HostTrustDecision,
} from "../host-trust-gate";
import { STORAGE_KEYS } from "@/config/constants";
import { isTrustedHost, getTrustedHosts } from "../trusted-hosts";

describe("host-trust-gate", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.TRUSTED_HOSTS);
  });

  afterEach(() => {
    resetHostTrustPromptForTests();
  });

  describe("listSecretHeaders", () => {
    it("detects credential-bearing header names case-insensitively", () => {
      expect(
        listSecretHeaders({
          Authorization: "Bearer x",
          "x-api-key": "k",
          "Content-Type": "application/json",
        })
      ).toEqual(["Authorization", "x-api-key"]);
    });
    it("detects arbitrary provider headers containing key/token/secret/auth", () => {
      expect(
        listSecretHeaders({
          "my-api-key": "secret",
          "provider_token": "tok",
          "client-secret": "sec",
          "x-custom-auth": "auth",
          "Accept": "application/json",
        })
      ).toEqual(["my-api-key", "provider_token", "client-secret", "x-custom-auth"]);
    });

    it("never returns header values", () => {
      const names = listSecretHeaders({ Authorization: "Bearer super-secret-value" });
      expect(names).toEqual(["Authorization"]);
      expect(names.join(",")).not.toContain("super-secret-value");
    });
  });

  describe("trusted host path", () => {
    it("passes headers through without prompting", async () => {
      let prompted = false;
      setHostTrustPrompt(async () => {
        prompted = true;
        return "deny";
      });

      const headers = { Authorization: "Bearer key" };
      const result = await resolveOutboundHeaders(
        "https://api.openai.com/v1/chat/completions",
        headers
      );
      expect(result.allowed).toBe(true);
      expect(result.headers).toEqual(headers);
      expect(prompted).toBe(false);
    });
  });

  describe("untrusted host path", () => {
    const untrusted = "https://evil.example/collect";
    const headers = { Authorization: "Bearer secret-key", "Content-Type": "application/json" };

    it("denies the request when no prompt handler is registered (fail closed)", async () => {
      const result = await resolveOutboundHeaders(untrusted, headers);
      expect(result.allowed).toBe(false);
      expect(result.headers).toEqual({});
    });

    it("denies and leaks no credentials when the user cancels", async () => {
      setHostTrustPrompt(async () => "deny" as HostTrustDecision);
      const result = await resolveOutboundHeaders(untrusted, headers);
      expect(result.allowed).toBe(false);
      expect(JSON.stringify(result)).not.toContain("secret-key");
    });

    it("sends without credentials when the user declines the key", async () => {
      setHostTrustPrompt(async () => "without-secrets" as HostTrustDecision);
      const result = await resolveOutboundHeaders(untrusted, headers);

      expect(result.allowed).toBe(true);
      expect(result.headers).not.toHaveProperty("Authorization");
      expect(result.headers).toHaveProperty("Content-Type", "application/json");
      expect(JSON.stringify(result)).not.toContain("secret-key");
    });

    it("keeps credentials and remembers the host when the user trusts it", async () => {
      setHostTrustPrompt(async () => "trust" as HostTrustDecision);
      const result = await resolveOutboundHeaders(untrusted, headers);

      expect(result.allowed).toBe(true);
      expect(result.headers).toEqual(headers);

      // Second call must not prompt again.
      let promptedAgain = false;
      setHostTrustPrompt(async () => {
        promptedAgain = true;
        return "deny" as HostTrustDecision;
      });
      const second = await resolveOutboundHeaders(untrusted, headers);
      expect(second.allowed).toBe(true);
      expect(promptedAgain).toBe(false);
    });

    it("reports the host and secret header names to the dialog", async () => {
      let seenHost = "";
      let seenSecrets: string[] = [];
      setHostTrustPrompt(async (request) => {
        seenHost = request.host;
        seenSecrets = request.secrets;
        return "deny" as HostTrustDecision;
      });

      await resolveOutboundHeaders(untrusted, headers);

      expect(seenHost).toBe("evil.example");
      expect(seenSecrets).toEqual(["Authorization"]);
    });

    it("always returns maxRedirections: 0 so client cannot follow redirects blindly", async () => {
      setHostTrustPrompt(async () => "trust" as HostTrustDecision);
      const result = await resolveOutboundHeaders(untrusted, headers);
      expect(result.maxRedirections).toBe(0);
    });

    describe("resolveRedirect (R13)", () => {
      it("allows same-host redirect without re-prompting", async () => {
        const res = await resolveRedirect(
          "https://api.openai.com/v1/chat",
          "https://api.openai.com/v2/chat",
          headers
        );
        expect(res.allowed).toBe(true);
        expect(res.maxRedirections).toBe(0);
        expect(res.headers).toEqual(headers);
      });

      it("denies cross-host redirect when untrusted and no prompt registered (fail-closed)", async () => {
        const res = await resolveRedirect(
          "https://api.openai.com/v1/chat",
          "https://evil.example/redirect-landing",
          headers
        );
        expect(res.allowed).toBe(false);
        expect(res.headers).toEqual({});
      });

      it("strips secrets on cross-host redirect when user selects without-secrets", async () => {
        setHostTrustPrompt(async () => "without-secrets" as HostTrustDecision);
        const res = await resolveRedirect(
          "https://api.openai.com/v1/chat",
          "https://evil.example/redirect-landing",
          headers
        );
        expect(res.allowed).toBe(true);
        expect(res.headers).not.toHaveProperty("Authorization");
        expect(res.headers["Content-Type"]).toBe("application/json");
      });
    });
  });

  /**
   * A scheme-less request URL is a broken request, not an untrusted host.
   *
   * Live report: the dialog quoted `null/v1/asr/transcribe?language=ru` as the
   * "host" and the user pressed "trust", so the literal `null` was written into
   * `trusted_hosts` — and from then on every request whose hostname coercion
   * produced `null` passed the trusted check silently. These tests fail if the
   * absolute-URL check is removed or moved back below `isTrustedHost`.
   */
  describe("non-absolute request URLs", () => {
    it("denies a scheme-less URL without prompting", async () => {
      let prompted = false;
      setHostTrustPrompt(async () => {
        prompted = true;
        return "trust" as HostTrustDecision;
      });

      const res = await resolveOutboundHeaders("null/v1/asr/transcribe?language=ru", {
        Authorization: "Bearer key",
      });

      expect(res.allowed).toBe(false);
      expect(res.headers).toEqual({});
      // The dialog must never see it: that is how `null` got trusted.
      expect(prompted).toBe(false);
    });

    it("denies a relative path even when 'null' is already a trusted host", async () => {
      // The exact bad state left behind by the live session.
      localStorage.setItem(STORAGE_KEYS.TRUSTED_HOSTS, JSON.stringify(["null"]));
      const res = await resolveOutboundHeaders("null/v1/asr/transcribe", {
        Authorization: "Bearer key",
      });
      expect(res.allowed).toBe(false);
      expect(res.headers).toEqual({});
    });

    it("stops counting a already-saved 'null' entry as a trusted host", () => {
      // Two independent guards, and this asserts the storage one: even if a bad
      // entry reaches `trusted_hosts`, a request whose host normalises to it must
      // not be trusted. Without the read filter, `isTrustedHost("http://null/x")`
      // returned true and the broken request sailed through the gate.
      localStorage.setItem(
        STORAGE_KEYS.TRUSTED_HOSTS,
        JSON.stringify(["null", "my-llm.internal"])
      );
      expect(isTrustedHost("http://null/v1/asr/transcribe")).toBe(false);
      // The legitimate entry alongside it keeps working.
      expect(isTrustedHost("https://my-llm.internal/v1")).toBe(true);
    });

    it("ignores stored entries that are not shaped like a host", () => {
      localStorage.setItem(
        STORAGE_KEYS.TRUSTED_HOSTS,
        JSON.stringify(["null/v1/asr/transcribe?language=ru", "", "  ", "ok.example"])
      );
      expect(getTrustedHosts()).toEqual(["ok.example"]);
    });

    it("still allows the absolute local engine URL", async () => {
      const res = await resolveOutboundHeaders(
        "http://127.0.0.1:9877/v1/asr/transcribe",
        {}
      );
      expect(res.allowed).toBe(true);
    });
  });
});
