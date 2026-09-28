import { describe, it, expect, beforeEach } from "vitest";
import { isTrustedHost, isBuiltInServiceHost } from "../trusted-hosts";
import { STORAGE_KEYS } from "@/config/constants";

/**
 * Реальные хосты, которые приложение вызывает само: они обязаны быть
 * авто-доверенными, иначе гейтирование (моя правка) превратит каждый обычный
 * запрос в диалог подтверждения.
 */
describe("auto-trusted hosts cover what the app actually calls", () => {
  beforeEach(() => localStorage.removeItem(STORAGE_KEYS.TRUSTED_HOSTS));

  it("trusts every host used by the AI providers", () => {
    for (const h of [
      "https://api.openai.com/v1/chat/completions",
      "https://api.anthropic.com/v1/messages",
      "https://api.x.ai/v1/chat/completions",
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      "https://api.mistral.ai/v1/chat/completions",
      "https://api.cohere.ai/v2/chat",
      "https://api.perplexity.ai/chat/completions",
      "https://openrouter.ai/api/v1/chat/completions",
    ]) {
      expect(isTrustedHost(h), h).toBe(true);
    }
  });

  it("trusts the gateway and every built-in service host", () => {
    expect(isTrustedHost("https://ai-gateway.nullform.cv/v1/chat/completions")).toBe(true);
    for (const h of [
      "https://api.search.brave.com/res/v1/web/search",
      "https://api.exa.ai/search",
      "https://api.tavily.com/search",
      "https://api.duckduckgo.com/?q=x",
      "https://translate.googleapis.com/translate_a/single",
    ]) {
      expect(isBuiltInServiceHost(h), h).toBe(true);
      expect(isTrustedHost(h), h).toBe(true);
    }
  });

  it("still refuses hosts that are not ours", () => {
    for (const h of [
      "https://evil.example/collect",
      "https://api.openai.com.evil.example/x",
      "https://api.tavily.com.evil.example/x",
    ]) {
      expect(isTrustedHost(h), h).toBe(false);
    }
  });
});
