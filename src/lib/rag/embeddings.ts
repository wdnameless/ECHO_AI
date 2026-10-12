import { safeLocalStorage } from "@/lib/storage/helper";
import { STORAGE_KEYS } from "@/config/constants";
import { assertHostTrusted } from "@/lib/host-trust-gate";

export interface EmbeddingProvider {
  id: "local" | "cloud";
  embed(texts: string[]): Promise<Float32Array[]>;
}

export const EMBEDDING_DIM = 384;

// FNV-1a 32-bit hash for fast, deterministic token hashing
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Lazy-loaded local embedding model instance.
 * Loaded only on first embed() invocation — zero startup bloat.
 */
class LocalEmbeddingModel {
  embedOne(text: string): Float32Array {
    const vec = new Float32Array(EMBEDDING_DIM);
    const lower = text.toLowerCase();
    const words = lower.match(/[\p{L}\p{N}]+/gu) || [];
    if (words.length === 0) return vec;

    for (let pos = 0; pos < words.length; pos++) {
      const word = words[pos];
      const h = fnv1a(word);
      const idx = h % EMBEDDING_DIM;
      const sign = (h & 0x10000) === 0 ? 1.0 : -1.0;
      const weight = 1.0 / (Math.sqrt(pos) + 1.0);
      vec[idx] += sign * (1.0 + weight);

      if (word.length >= 3) {
        for (let i = 0; i <= word.length - 3; i++) {
          const gram = word.slice(i, i + 3);
          const gh = fnv1a(gram);
          const gidx = gh % EMBEDDING_DIM;
          const gsign = (gh & 0x10000) === 0 ? 1.0 : -1.0;
          vec[gidx] += gsign * 0.5;
        }
      }
    }

    let normSq = 0;
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      normSq += vec[i] * vec[i];
    }
    const norm = Math.sqrt(normSq);
    if (norm > 1e-6) {
      for (let i = 0; i < EMBEDDING_DIM; i++) {
        vec[i] /= norm;
      }
    }
    return vec;
  }
}

let cachedLocalModel: LocalEmbeddingModel | null = null;

function getLocalModel(): LocalEmbeddingModel {
  if (!cachedLocalModel) {
    cachedLocalModel = new LocalEmbeddingModel();
  }
  return cachedLocalModel;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local" as const;

  async embed(texts: string[]): Promise<Float32Array[]> {
    const model = getLocalModel();
    return texts.map((t) => model.embedOne(t));
  }
}

export class CloudEmbeddingProvider implements EmbeddingProvider {
  readonly id = "cloud" as const;

  constructor(
    private endpoint: string = "https://api.openai.com/v1/embeddings",
    private apiKey?: string,
    private model: string = "text-embedding-3-small"
  ) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!this.apiKey) {
      throw new Error("Cloud embeddings require an API key");
    }

    // Host-trust gate: fail closed if untrusted or user denies
    const trusted = await assertHostTrusted(this.endpoint, ["api-key"]);
    if (!trusted) {
      throw new Error(`Untrusted host for embeddings: ${this.endpoint}`);
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        dimensions: EMBEDDING_DIM,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloud embedding failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.data.map(
      (item: { embedding: number[] }) => new Float32Array(item.embedding)
    );
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const backend = safeLocalStorage.getItem(STORAGE_KEYS.EMBEDDINGS_BACKEND);
  const cloudKey =
    safeLocalStorage.getItem(STORAGE_KEYS.EMBEDDINGS_CLOUD_KEY) || undefined;

  // Cloud backend is enabled ONLY when explicitly set to "cloud" and key is present
  if (backend === "cloud" && cloudKey) {
    const endpoint =
      safeLocalStorage.getItem(STORAGE_KEYS.EMBEDDINGS_CLOUD_ENDPOINT) ||
      "https://api.openai.com/v1/embeddings";
    const model =
      safeLocalStorage.getItem(STORAGE_KEYS.EMBEDDINGS_CLOUD_MODEL) ||
      "text-embedding-3-small";
    return new CloudEmbeddingProvider(endpoint, cloudKey, model);
  }

  // Default is offline local provider
  return new LocalEmbeddingProvider();
}
