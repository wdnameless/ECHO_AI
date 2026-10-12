import { invoke } from "@tauri-apps/api/core";
import { getEmbeddingProvider } from "./embeddings";

/** Локальный индекс памяти встреч. Поиск — всегда локально. */
export interface MemoryHit {
  conversationId: string;
  chunkId: string;
  score: number;
  text: string;
}

export function chunkSegments(
  segments: { text: string; ts: number }[],
  maxWords = 120
): string[] {
  const chunks: string[] = [];
  let current: string[] = [];

  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    const words = text.split(/\s+/);
    if (current.length + words.length > maxWords && current.length > 0) {
      chunks.push(current.join(" "));
      current = [];
    }
    current.push(...words);
  }
  if (current.length > 0) {
    chunks.push(current.join(" "));
  }
  return chunks;
}

export async function indexTranscript(
  conversationId: string,
  segments: { text: string; ts: number }[]
): Promise<void> {
  const chunks = chunkSegments(segments);
  if (chunks.length === 0) return;

  const provider = getEmbeddingProvider();
  const embeddings = await provider.embed(chunks);
  const vectors = embeddings.map((vec) => Array.from(vec));

  await invoke<number>("memory_index", {
    conversation_id: conversationId,
    chunks,
    vectors,
  });
}

export async function searchMemory(
  query: string,
  limit = 5
): Promise<MemoryHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const provider = getEmbeddingProvider();
  const [queryVec] = await provider.embed([trimmed]);
  const queryVector = Array.from(queryVec);

  return await invoke<MemoryHit[]>("memory_search", {
    query: trimmed,
    limit,
    query_vector: queryVector,
  });
}
