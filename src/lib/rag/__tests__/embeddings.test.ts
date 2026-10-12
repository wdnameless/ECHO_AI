import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getEmbeddingProvider,
  LocalEmbeddingProvider,
  CloudEmbeddingProvider,
  EMBEDDING_DIM,
} from "../embeddings";
import { STORAGE_KEYS } from "@/config/constants";
import * as hostTrustGate from "@/lib/host-trust-gate";

describe("embeddings provider (R02, R03)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("defaults to offline local provider on fresh install without cloud keys", () => {
    const provider = getEmbeddingProvider();
    expect(provider.id).toBe("local");
    expect(provider).toBeInstanceOf(LocalEmbeddingProvider);
  });

  it("local provider embeds text into normalized 384-dimensional vectors offline", async () => {
    const provider = new LocalEmbeddingProvider();
    const [vec1, vec2] = await provider.embed([
      "John discussed API architecture",
      "Pizza for lunch tomorrow",
    ]);

    expect(vec1).toBeInstanceOf(Float32Array);
    expect(vec1.length).toBe(EMBEDDING_DIM);
    expect(vec2.length).toBe(EMBEDDING_DIM);

    // Identical text produces identical embedding
    const [vec1Dup] = await provider.embed(["John discussed API architecture"]);
    expect(Array.from(vec1)).toEqual(Array.from(vec1Dup));

    // Vector is unit normalized
    let norm = 0;
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      norm += vec1[i] * vec1[i];
    }
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 4);
  });

  it("activates cloud provider only with explicit toggle AND key configured", () => {
    // Only toggle set, no key -> must stay local
    localStorage.setItem(STORAGE_KEYS.EMBEDDINGS_BACKEND, "cloud");
    expect(getEmbeddingProvider().id).toBe("local");

    // Both toggle and key set -> cloud provider
    localStorage.setItem(STORAGE_KEYS.EMBEDDINGS_CLOUD_KEY, "sk-test-key");
    const cloudProvider = getEmbeddingProvider();
    expect(cloudProvider.id).toBe("cloud");
    expect(cloudProvider).toBeInstanceOf(CloudEmbeddingProvider);
  });

  it("cloud provider enforces trusted-host gate before outbound requests", async () => {
    const gateSpy = vi.spyOn(hostTrustGate, "assertHostTrusted").mockResolvedValue(false);

    const provider = new CloudEmbeddingProvider(
      "https://untrusted.ai/v1/embeddings",
      "sk-secret"
    );

    await expect(provider.embed(["test query"])).rejects.toThrow("Untrusted host");
    expect(gateSpy).toHaveBeenCalledWith("https://untrusted.ai/v1/embeddings", ["api-key"]);
  });

  it("cloud provider fetches embeddings when host is trusted", async () => {
    vi.spyOn(hostTrustGate, "assertHostTrusted").mockResolvedValue(true);

    const fakeVector = new Array(EMBEDDING_DIM).fill(0.1);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: fakeVector }],
      }),
    } as unknown as Response);

    const provider = new CloudEmbeddingProvider(
      "https://api.openai.com/v1/embeddings",
      "sk-secret",
      "text-embedding-3-small"
    );

    const results = await provider.embed(["test document"]);
    expect(results.length).toBe(1);
    expect(results[0].length).toBe(EMBEDDING_DIM);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-secret",
        }),
      })
    );
  });
});
