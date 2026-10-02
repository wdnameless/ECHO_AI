import { beforeEach, describe, expect, it } from "vitest";
import { getAIProviderVariables, setAIProviderVariables } from "../ai-providers";
import { STORAGE_KEYS } from "@/config/constants";

beforeEach(() => localStorage.clear());
describe("provider configuration persistence", () => {
  it("retains each model and nonsecret configuration across switches and readers without credentials", () => {
    setAIProviderVariables("first", { model: "first-model", reasoning_effort: "high", API_KEY: "fixture-secret", access_token: "fixture-token" });
    setAIProviderVariables("second", { MODEL: "second-model", REGION: "eu", PASSWORD: "fixture-password" });
    expect(getAIProviderVariables("first")).toEqual({ MODEL: "first-model", REASONING_EFFORT: "high" });
    expect(getAIProviderVariables("second")).toEqual({ MODEL: "second-model", REGION: "eu" });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.AI_PROVIDER_VARIABLES)!)).toEqual({
      first: { MODEL: "first-model", REASONING_EFFORT: "high" }, second: { MODEL: "second-model", REGION: "eu" },
    });
    getAIProviderVariables("first").MODEL = "in-memory edit";
    expect(getAIProviderVariables("first").MODEL).toBe("first-model");
    setAIProviderVariables("first", { MODEL: "updated-first" });
    expect(getAIProviderVariables("second").MODEL).toBe("second-model");
    expect(getAIProviderVariables("first").MODEL).toBe("updated-first");
  });
  it("persists token budgets but excludes normalized credential field names", () => {
    const budgets = { MAX_TOKENS: "512", MAX_OUTPUT_TOKENS: "1024", TOKEN_BUDGET: "64" };
    const credentials = Object.fromEntries([
      "API_KEY", "apiKey", "access-token", "refresh_token", "client.secret",
      "password", "passwd", "pwd", "authorization", "authentication",
      "clientCredentials", "signature", "KEY", "auth", "session-id", "Cookie",
    ].map((name) => [name, "fixture-credential"]));
    setAIProviderVariables("budget-provider", { ...budgets, ...credentials });
    setAIProviderVariables("another-provider", { MODEL: "another-model" });
    expect(getAIProviderVariables("budget-provider")).toEqual(budgets);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.AI_PROVIDER_VARIABLES)!)["budget-provider"]).toEqual(budgets);
  });
  it("ignores malformed persisted config and removes historical credentials on the next map write", () => {
    localStorage.setItem(STORAGE_KEYS.AI_PROVIDER_VARIABLES, JSON.stringify({ first: { MODEL: "saved", apiKey: "fixture" }, invalid: ["not variables"] }));
    expect(getAIProviderVariables("first")).toEqual({ MODEL: "saved" });
    expect(getAIProviderVariables("invalid")).toEqual({});
    setAIProviderVariables("second", { MODEL: "new" });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.AI_PROVIDER_VARIABLES)!)).toEqual({ first: { MODEL: "saved" }, invalid: {}, second: { MODEL: "new" } });
    localStorage.setItem(STORAGE_KEYS.AI_PROVIDER_VARIABLES, "broken json");
    expect(getAIProviderVariables("first")).toEqual({});
  });
});
