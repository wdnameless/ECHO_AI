import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  indexTranscript,
  searchMemory,
  chunkSegments,
  MemoryHit,
} from "../memory-index";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("memory-index (R01, R04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("chunks transcript segments into word-bounded chunks", () => {
    const segments = [
      { text: "Hello everyone, welcome to the meeting.", ts: 100 },
      { text: "Today we are discussing the new vector database integration.", ts: 200 },
      { text: "John will lead the presentation.", ts: 300 },
    ];
    const chunks = chunkSegments(segments, 15);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join(" ")).toContain("vector database integration");
  });

  it("indexTranscript computes embeddings and invokes memory_index", async () => {
    const mockInvoke = vi.mocked(invoke).mockResolvedValue(3);

    const segments = [
      { text: "John presented the API roadmap.", ts: 1000 },
      { text: "The team agreed on SQLite with vector extensions.", ts: 2000 },
    ];

    await indexTranscript("conv-42", segments);

    expect(mockInvoke).toHaveBeenCalledWith(
      "memory_index",
      expect.objectContaining({
        conversation_id: "conv-42",
        chunks: expect.arrayContaining([
          expect.stringContaining("John presented the API roadmap"),
        ]),
        vectors: expect.any(Array),
      })
    );
  });

  it("searchMemory computes query embedding and invokes memory_search", async () => {
    const mockHits: MemoryHit[] = [
      {
        conversationId: "conv-42",
        chunkId: "conv-42:0",
        score: 0.95,
        text: "John presented the API roadmap.",
      },
    ];
    const mockInvoke = vi.mocked(invoke).mockResolvedValue(mockHits);

    const hits = await searchMemory("what did John say about the API?", 3);

    expect(hits).toEqual(mockHits);
    expect(mockInvoke).toHaveBeenCalledWith(
      "memory_search",
      expect.objectContaining({
        query: "what did John say about the API?",
        limit: 3,
        query_vector: expect.any(Array),
      })
    );
  });

  it("searchMemory returns empty array on empty query without invoking backend", async () => {
    const mockInvoke = vi.mocked(invoke);
    const hits = await searchMemory("   ");
    expect(hits).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
