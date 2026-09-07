import { describe, it, expect } from "vitest";
import { canonicalizeVariables } from "../common.function";
import {
  resolveModelVariable,
  resolveProviderModel,
} from "../ai-response.function";
import { TYPE_PROVIDER } from "@/types";

describe("Model key collision and canonicalization", () => {
  describe("canonicalizeVariables", () => {
    it("collapses duplicate MODEL and model with different values, giving priority to lowercase 'model'", () => {
      const input = {
        MODEL: "gemini-3.6-flash-low",
        model: "gemini-3.8-flash-low",
      };
      const result = canonicalizeVariables(input);
      expect(result).toEqual({
        MODEL: "gemini-3.8-flash-low",
      });
    });

    it("deduplicates duplicate MODEL and model with same values into a single MODEL key", () => {
      const input = {
        MODEL: "gemini-3.6-flash-low",
        model: "gemini-3.6-flash-low",
      };
      const result = canonicalizeVariables(input);
      expect(result).toEqual({
        MODEL: "gemini-3.6-flash-low",
      });
    });

    it("canonicalizes api_key and API_KEY pairs giving priority to lowercase key if conflicting", () => {
      const input = {
        api_key: "fresh_secret_key",
        API_KEY: "stale_secret_key",
      };
      const result = canonicalizeVariables(input);
      expect(result).toEqual({
        API_KEY: "fresh_secret_key",
      });
    });

    it("preserves single keys normalized to uppercase canonical placeholder format", () => {
      const input = {
        apiKey: "some_key",
        ENDPOINT: "https://example.com",
      };
      const result = canonicalizeVariables(input);
      expect(result).toEqual({
        APIKEY: "some_key",
        ENDPOINT: "https://example.com",
      });
    });

    it("handles multiple keys together including MODEL/model collision and API_KEY", () => {
      const input = {
        API_KEY: "my-api-key",
        MODEL: "gemini-3.6-flash-low",
        model: "gemini-3.8-flash-low",
        TEMP: "0.7",
      };
      const result = canonicalizeVariables(input);
      expect(result).toEqual({
        API_KEY: "my-api-key",
        MODEL: "gemini-3.8-flash-low",
        TEMP: "0.7",
      });
    });

    it("handles empty or non-object variables safely", () => {
      expect(canonicalizeVariables(undefined)).toEqual({});
      expect(canonicalizeVariables(null)).toEqual({});
      expect(canonicalizeVariables({})).toEqual({});
    });

    it("picks non-empty value if one of the case variants is empty", () => {
      const input = {
        MODEL: "gemini-3.6-flash-low",
        model: "",
      };
      const result = canonicalizeVariables(input);
      expect(result).toEqual({
        MODEL: "gemini-3.6-flash-low",
      });
    });
  });

  describe("resolveModelVariable", () => {
    it("prefers lowercase 'model' when both MODEL and model have different non-empty values", () => {
      const vars = {
        MODEL: "gemini-3.6-flash-low",
        model: "gemini-3.8-flash-low",
      };
      expect(resolveModelVariable(vars)).toBe("gemini-3.8-flash-low");
    });

    it("returns the model value when only MODEL is present", () => {
      const vars = {
        MODEL: "gemini-3.6-flash-low",
      };
      expect(resolveModelVariable(vars)).toBe("gemini-3.6-flash-low");
    });

    it("returns the model value when only model is present", () => {
      const vars = {
        model: "gemini-3.8-flash-low",
      };
      expect(resolveModelVariable(vars)).toBe("gemini-3.8-flash-low");
    });

    it("returns non-empty value when one key has an empty string", () => {
      const vars = {
        MODEL: "gemini-3.6-flash-low",
        model: "   ",
      };
      expect(resolveModelVariable(vars)).toBe("gemini-3.6-flash-low");
    });

    it("returns empty string when no model keys exist or variables is empty", () => {
      expect(resolveModelVariable({})).toBe("");
      expect(resolveModelVariable(undefined)).toBe("");
      expect(resolveModelVariable(null)).toBe("");
    });
  });

  describe("resolveProviderModel with dual keys", () => {
    const mockProvider: TYPE_PROVIDER = {
      id: "test-provider",
      curl: 'curl -X POST "https://api.test/v1/chat" -d \'{"model": "gemini-3.6-flash-low"}\'',
    };
    it("returns the fresh lowercase model when both MODEL (stale) and model (fresh) exist", () => {
      const selected = {
        provider: "test-provider",
        variables: {
          MODEL: "gemini-3.6-flash-low",
          model: "gemini-3.8-flash-low",
        },
      };

      const resolved = resolveProviderModel(mockProvider, selected);
      expect(resolved).toBe("gemini-3.8-flash-low");
    });

    it("falls back to curl literal model when variables has no model key", () => {
      const selected = {
        provider: "test-provider",
        variables: {
          API_KEY: "secret",
        },
      };

      const resolved = resolveProviderModel(mockProvider, selected);
      expect(resolved).toBe("gemini-3.6-flash-low");
    });
  });

  describe("Reasoning effort override", () => {
    it("canonicalizes REASONING_EFFORT if provided in variables", () => {
      const input = {
        reasoning_effort: "high",
      };
      const result = canonicalizeVariables(input);
      expect(result).toEqual({
        REASONING_EFFORT: "high",
      });
    });
  });
});
