import { describe, it, expect, beforeEach } from "vitest";
import {
  getHostOfCurlTemplate,
  isTrustedHost,
  trustHost,
  untrustHost,
  getTrustedHosts,
} from "../trusted-hosts";
import { STORAGE_KEYS } from "@/config/constants";

describe("trusted-hosts", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.TRUSTED_HOSTS);
  });

  describe("getHostOfCurlTemplate", () => {
    it("extracts host from a provider curl template", () => {
      expect(
        getHostOfCurlTemplate(
          `curl https://api.openai.com/v1/chat/completions -H "Authorization: Bearer {{API_KEY}}"`
        )
      ).toBe("api.openai.com");
    });

    it("extracts host from --url form", () => {
      expect(
        getHostOfCurlTemplate(`curl --url "https://api.anthropic.com/v1/messages"`)
      ).toBe("api.anthropic.com");
    });

    it("returns null when the host itself is a template variable", () => {
      expect(getHostOfCurlTemplate(`curl {{API_HOST}}/v1/chat`)).toBeNull();
    });

    it("returns null for input without a url", () => {
      expect(getHostOfCurlTemplate("curl -X POST")).toBeNull();
    });
  });

  describe("isTrustedHost", () => {
    it("trusts localhost variants", () => {
      expect(isTrustedHost("http://127.0.0.1:9877/v1/asr")).toBe(true);
      expect(isTrustedHost("localhost:8765")).toBe(true);
    });

    it("trusts hosts of the built-in providers", () => {
      expect(isTrustedHost("https://api.openai.com/v1/chat/completions")).toBe(true);
      expect(isTrustedHost("https://api.anthropic.com/v1/messages")).toBe(true);
    });

    it("does not trust an arbitrary third-party host", () => {
      expect(isTrustedHost("https://evil.example.com/collect")).toBe(false);
    });

    it("does not trust a host merely because it contains a trusted name", () => {
      expect(isTrustedHost("https://api.openai.com.evil.example/x")).toBe(false);
    });

    it("returns false for empty input", () => {
      expect(isTrustedHost("")).toBe(false);
    });
  });

  describe("user trust list", () => {
    it("trusts a host after explicit confirmation and persists it", () => {
      expect(isTrustedHost("https://my-llm.internal/v1")).toBe(false);
      trustHost("my-llm.internal");
      expect(isTrustedHost("https://my-llm.internal/v1")).toBe(true);
      expect(getTrustedHosts()).toContain("my-llm.internal");
    });

    it("survives a fresh read from storage", () => {
      trustHost("custom.provider.io");
      const stored = localStorage.getItem(STORAGE_KEYS.TRUSTED_HOSTS);
      expect(stored).toBeTruthy();
      expect(JSON.parse(stored as string)).toContain("custom.provider.io");
    });

    it("removes a host on untrust", () => {
      trustHost("temporary.example");
      expect(isTrustedHost("temporary.example")).toBe(true);
      untrustHost("temporary.example");
      expect(isTrustedHost("temporary.example")).toBe(false);
    });

    it("does not duplicate an already trusted host", () => {
      trustHost("dup.example");
      trustHost("dup.example");
      expect(getTrustedHosts().filter((h) => h === "dup.example")).toHaveLength(1);
    });
  });
});
