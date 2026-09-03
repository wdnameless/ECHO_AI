import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveModelsUrl,
  normalizeModelsResponse,
  fetchProviderModels,
} from "../models.function";

const mockTauriFetch = vi.fn();

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => mockTauriFetch(...args),
}));

describe("models.function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveModelsUrl", () => {
    it("resolves OpenAI completions endpoint to /v1/models", () => {
      const url = "https://api.openai.com/v1/chat/completions";
      expect(resolveModelsUrl("openai", url)).toBe("https://api.openai.com/v1/models");
    });

    it("resolves OpenRouter chat endpoint to /api/v1/models", () => {
      const url = "https://openrouter.ai/api/v1/chat/completions";
      expect(resolveModelsUrl("openrouter", url)).toBe("https://openrouter.ai/api/v1/models");
    });

    it("resolves Anthropic messages endpoint to /v1/models", () => {
      const url = "https://api.anthropic.com/v1/messages";
      expect(resolveModelsUrl("claude", url)).toBe("https://api.anthropic.com/v1/models");
    });

    it("resolves Ollama endpoint to /api/tags regardless of subpath", () => {
      expect(resolveModelsUrl("ollama", "http://localhost:11434/api/generate")).toBe("http://localhost:11434/api/tags");
      expect(resolveModelsUrl("ollama", "http://localhost:11434/v1/chat/completions")).toBe("http://localhost:11434/api/tags");
      expect(resolveModelsUrl("ollama", "http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434/api/tags");
    });

    it("resolves custom endpoint with /completions", () => {
      const url = "https://custom-ai.org/v2/completions";
      expect(resolveModelsUrl("custom", url)).toBe("https://custom-ai.org/v2/models");
    });

    it("resolves custom endpoint with /api/generate to /api/tags", () => {
      const url = "https://custom-llm.local/api/generate";
      expect(resolveModelsUrl("custom", url)).toBe("https://custom-llm.local/api/tags");
    });

    it("falls back to appending /models if no known path matched", () => {
      const url = "https://my-proxy.internal/v1";
      expect(resolveModelsUrl("custom", url)).toBe("https://my-proxy.internal/v1/models");
    });
  });

  describe("normalizeModelsResponse", () => {
    it("normalizes OpenAI format { data: [{ id }] }", () => {
      const payload = {
        object: "list",
        data: [
          { id: "gpt-4o", created: 123 },
          { id: "gpt-3.5-turbo", created: 124 },
          { id: "chatgpt-4o-latest", created: 125 },
        ],
      };
      const result = normalizeModelsResponse(payload);
      expect(result).toEqual(["chatgpt-4o-latest", "gpt-3.5-turbo", "gpt-4o"]);
    });

    it("normalizes Ollama format { models: [{ name, model }] }", () => {
      const payload = {
        models: [
          { name: "llama3:latest", model: "llama3:latest" },
          { name: "mistral:instruct", model: "mistral:instruct" },
          { name: "deepseek-coder:6.7b", model: "deepseek-coder:6.7b" },
        ],
      };
      const result = normalizeModelsResponse(payload);
      expect(result).toEqual(["deepseek-coder:6.7b", "llama3:latest", "mistral:instruct"]);
    });

    it("normalizes flat string array and deduplicates items", () => {
      const payload = ["claude-3-opus", "claude-3-sonnet", "claude-3-opus", "claude-3-5-sonnet"];
      const result = normalizeModelsResponse(payload);
      expect(result).toEqual(["claude-3-5-sonnet", "claude-3-opus", "claude-3-sonnet"]);
    });

    it("returns empty array for invalid/null input", () => {
      expect(normalizeModelsResponse(null)).toEqual([]);
      expect(normalizeModelsResponse({})).toEqual([]);
      expect(normalizeModelsResponse("string")).toEqual([]);
    });
  });

  describe("fetchProviderModels", () => {
    it("fetches and normalizes models via tauriFetch with replaced variables", async () => {
      const curl = `curl https://api.openai.com/v1/chat/completions \\
        -H "Content-Type: application/json" \\
        -H "Authorization: Bearer {{API_KEY}}" \\
        -d '{"model": "{{MODEL}}"}'`;

      const variables = {
        API_KEY: "sk-test-12345",
        MODEL: "gpt-4o",
      };

      mockTauriFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }],
        }),
      });

      const models = await fetchProviderModels("openai", curl, variables);

      expect(mockTauriFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockTauriFetch.mock.calls[0];
      expect(calledUrl).toBe("https://api.openai.com/v1/models");
      expect(calledInit.method).toBe("GET");
      expect(calledInit.headers["Authorization"]).toBe("Bearer sk-test-12345");
      expect(models).toEqual(["gpt-4o", "gpt-4o-mini"]);
    });

    it("fetches Ollama models via /api/tags without requiring auth", async () => {
      const curl = `curl http://localhost:11434/api/generate -d '{"model": "{{MODEL}}"}'`;
      const variables = { MODEL: "llama3" };

      mockTauriFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "llama3:latest" }, { name: "phi3:mini" }],
        }),
      });

      const models = await fetchProviderModels("ollama", curl, variables);

      expect(mockTauriFetch).toHaveBeenCalledTimes(1);
      const [calledUrl] = mockTauriFetch.mock.calls[0];
      expect(calledUrl).toBe("http://localhost:11434/api/tags");
      expect(models).toEqual(["llama3:latest", "phi3:mini"]);
    });

    it("throws clear error on HTTP non-200", async () => {
      const curl = `curl https://api.openai.com/v1/chat/completions`;
      mockTauriFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => JSON.stringify({ error: { message: "Invalid API Key" } }),
      });

      await expect(fetchProviderModels("openai", curl, {})).rejects.toThrow("HTTP 401");
    });

    it("throws error on empty models list", async () => {
      const curl = `curl https://api.openai.com/v1/chat/completions`;
      mockTauriFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await expect(fetchProviderModels("openai", curl, {})).rejects.toThrow(
        "Провайдер вернул пустой список моделей"
      );
    });
  });
});
