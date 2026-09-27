import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createConversation,
  updateConversation,
  generateConversationTitle,
} from "../chat-history.action";
import type { ChatConversation } from "@/types";

const mockExecute = vi.fn();
const mockSelect = vi.fn();

vi.mock("../config", () => ({
  // Passthrough: these tests assert BEGIN/COMMIT ordering, so the lock must run.
  withWriteLock: (fn: () => unknown) => fn(),
  getDatabase: vi.fn().mockImplementation(() =>
    Promise.resolve({
      execute: mockExecute,
      select: mockSelect,
    })
  ),
}));

describe("chat-history.action transactions and batch inserts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rowsAffected: 1 });
    mockSelect.mockResolvedValue([]);
  });

  /**
   * These writers used to open BEGIN/COMMIT, which cannot work here: the SQL
   * plugin's pool does not pin one connection to a sequence of execute() calls
   * (measured live — a CREATE TABLE and the following INSERT landed on
   * different connections, so the second said "no such table"). A manual
   * transaction therefore ran across arbitrary connections, and two overlapping
   * saves destroyed each other with "cannot commit - no transaction is active".
   * The assertions below pin the replacement contract: batched statements, no
   * transaction control, and an error that still propagates.
   */
  it("batches conversation and messages without transaction control", async () => {
    const conv: ChatConversation = {
      id: "conv-1",
      title: "Test Conversation",
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        { id: "m-1", role: "user", content: "Hello", timestamp: 1100 },
        { id: "m-2", role: "assistant", content: "Hi there", timestamp: 1200 },
      ],
    };

    const result = await createConversation(conv);
    expect(result).toEqual(conv);

    const queries = mockExecute.mock.calls.map((c) => String(c[0]));
    expect(queries.some((q) => /BEGIN|COMMIT|ROLLBACK/i.test(q))).toBe(false);
    expect(queries[0]).toContain("INSERT INTO conversations");
    const batch = queries.find((q) => q.includes("INSERT INTO messages"));
    // one statement carrying both rows
    expect(batch).toContain("(?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)");
  });

  it("propagates a write error to the caller", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Disk full"));

    const conv: ChatConversation = {
      id: "conv-fail",
      title: "Fail Conv",
      createdAt: 1000,
      updatedAt: 1000,
      messages: [],
    };

    await expect(createConversation(conv)).rejects.toThrow("Disk full");
  });

  it("updateConversation replaces messages and prunes the ones removed", async () => {
    const conv: ChatConversation = {
      id: "conv-up",
      title: "Updated Title",
      createdAt: 1000,
      updatedAt: 2500,
      messages: [
        { id: "m-1", role: "user", content: "Updated Hello", timestamp: 1100 },
        { id: "m-3", role: "user", content: "New question", timestamp: 2400 },
      ],
    };

    await updateConversation(conv);

    const queries = mockExecute.mock.calls.map((c) => String(c[0]));
    expect(queries.some((q) => /BEGIN|COMMIT|ROLLBACK/i.test(q))).toBe(false);
    expect(queries[0]).toContain("UPDATE conversations");
    expect(queries.some((q) => q.includes("INSERT OR REPLACE INTO messages"))).toBe(true);
    expect(
      queries.some((q) =>
        q.includes("DELETE FROM messages WHERE conversation_id = ? AND id NOT IN (?, ?)")
      )
    ).toBe(true);
  });

  it("generateConversationTitle trims input", () => {
    expect(generateConversationTitle("  Hello world  ")).toBe("Hello world");
  });
});
