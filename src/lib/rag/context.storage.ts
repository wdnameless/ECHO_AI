import { getDatabase } from "@/lib/database";

export type RagContextType = "resume" | "job";

export interface RagContext {
  id: string;
  type: RagContextType;
  content: string;
  sourceName: string | null;
  updatedAt: number;
}

interface RagContextRow {
  id: string;
  type: string;
  content: string;
  source_name: string | null;
  updated_at: number;
}

function mapRow(row: RagContextRow): RagContext {
  return {
    id: row.id,
    type: row.type as RagContextType,
    content: row.content,
    sourceName: row.source_name,
    updatedAt: row.updated_at,
  };
}

// In-memory cache to avoid a DB round-trip on every AI request.
// This removes ~50-150ms of latency from each prompt build.
const CACHE_TTL_MS = 30_000;
const cache = new Map<RagContextType, { value: RagContext | null; at: number }>();

export async function getRagContext(
  type: RagContextType
): Promise<RagContext | null> {
  const cached = cache.get(type);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }
  try {
    const db = await getDatabase();
    const rows = await db.select<RagContextRow[]>(
      "SELECT id, type, content, source_name, updated_at FROM rag_contexts WHERE type = $1 LIMIT 1",
      [type]
    );
    const value = rows.length > 0 ? mapRow(rows[0]) : null;
    cache.set(type, { value, at: Date.now() });
    return value;
  } catch {
    return null;
  }
}

export async function setRagContext(
  type: RagContextType,
  content: string,
  sourceName?: string
): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(
      "INSERT OR REPLACE INTO rag_contexts (id, type, content, source_name, updated_at) VALUES ($1, $2, $3, $4, $5)",
      [type, type, content, sourceName ?? null, Date.now()]
    );
    cache.delete(type);
  } catch {}
}

export async function deleteRagContext(type: RagContextType): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute("DELETE FROM rag_contexts WHERE type = $1", [type]);
    cache.delete(type);
  } catch {}
}

export async function getRagContexts(): Promise<RagContext[]> {
  try {
    const db = await getDatabase();
    const rows = await db.select<RagContextRow[]>(
      "SELECT id, type, content, source_name, updated_at FROM rag_contexts ORDER BY updated_at DESC"
    );
    return rows.map(mapRow);
  } catch {
    return [];
  }
}
