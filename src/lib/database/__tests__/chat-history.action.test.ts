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

  it("createConversation wraps conversation and messages in BEGIN/COMMIT transaction with batch insert", async () => {
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

    expect(mockExecute).toHaveBeenCalledTimes(4);
    // 1. BEGIN TRANSACTION
    expect(mockExecute.mock.calls[0][0]).toBe("BEGIN TRANSACTION");
    // 2. INSERT conversation
    expect(mockExecute.mock.calls[1][0]).toContain("INSERT INTO conversations");
    // 3. Batch INSERT messages (single query with 2 placeholders)
    expect(mockExecute.mock.calls[2][0]).toContain("INSERT INTO messages");
    expect(mockExecute.mock.calls[2][0]).toContain("(?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)");
    // 4. COMMIT
    expect(mockExecute.mock.calls[3][0]).toBe("COMMIT");
  });

  it("createConversation rolls back on error", async () => {
    mockExecute
      .mockResolvedValueOnce({ rowsAffected: 1 }) // BEGIN
      .mockRejectedValueOnce(new Error("Disk full")); // INSERT fails

    const conv: ChatConversation = {
      id: "conv-fail",
      title: "Fail Conv",
      createdAt: 1000,
      updatedAt: 1000,
      messages: [],
    };

    await expect(createConversation(conv)).rejects.toThrow("Disk full");
    expect(mockExecute).toHaveBeenCalledWith("ROLLBACK");
  });

  it("updateConversation batches message replacements in a transaction and cleans up removed messages", async () => {
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

    expect(mockExecute.mock.calls[0][0]).toBe("BEGIN TRANSACTION");
    expect(mockExecute.mock.calls[1][0]).toContain("UPDATE conversations");
    expect(mockExecute.mock.calls[2][0]).toContain("INSERT OR REPLACE INTO messages");
    expect(mockExecute.mock.calls[3][0]).toContain("DELETE FROM messages WHERE conversation_id = ? AND id NOT IN (?, ?)");
    expect(mockExecute.mock.calls[4][0]).toBe("COMMIT");
  });

  it("generateConversationTitle trims input", () => {
    expect(generateConversationTitle("  Hello world  ")).toBe("Hello world");
  });
});
