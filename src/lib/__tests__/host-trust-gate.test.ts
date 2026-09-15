import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveOutboundHeaders,
  listSecretHeaders,
  setHostTrustPrompt,
  resetHostTrustPromptForTests,
  type HostTrustDecision,
} from "../host-trust-gate";
import { STORAGE_KEYS } from "@/config/constants";

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
  });
});
