import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseSync, type SupportedValueType } from "node:sqlite";
import {
  createConversation,
  updateConversation,
  getAllConversations,
  migrateLocalStorageToSQLite,
} from "../chat-history.action";
import type { ChatConversation } from "@/types";
import { safeLocalStorage } from "@/lib";

let memoryDb: DatabaseSync;
let selectQueries: string[] = [];

vi.mock("../config", () => ({
  getDatabase: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      execute: async (query: string, params: unknown[] = []) => {
        const stmt = memoryDb.prepare(query);
        const result = stmt.run(...(params as SupportedValueType[]));
        return { rowsAffected: Number(result.changes) };
      },
      select: async <T>(query: string, params: unknown[] = []): Promise<T> => {
        selectQueries.push(query);
        const stmt = memoryDb.prepare(query);
        const rows = stmt.all(...(params as SupportedValueType[]));
        return rows as unknown as T;
      },
    });
  }),
}));

describe("chat-history actions audit fixes (R01, R02, R26, R27)", () => {
  beforeEach(() => {
    selectQueries = [];
    safeLocalStorage.removeItem("chat_history");
    safeLocalStorage.removeItem("chat_history_migrated_to_sqlite");

    memoryDb = new DatabaseSync(":memory:");
    memoryDb.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        attached_files TEXT
      );
    `);
  });

  describe("R01 / R02: Retention of >100 messages on update", () => {
    it("retains all 150 messages when updating a conversation (R01, R02)", async () => {
      const convId = "conv-150";
      const initialMessages = Array.from({ length: 150 }, (_, i) => ({
        id: `msg-${i}`,
        role: "user" as const,
        content: `Message ${i}`,
        timestamp: 1000 + i,
      }));

      const conversation: ChatConversation = {
        id: convId,
        title: "150 Messages Test",
        createdAt: 1000,
        updatedAt: 2000,
        messages: initialMessages,
      };

      await createConversation(conversation);

      const initialRows = memoryDb
        .prepare("SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?")
        .get(convId) as { count: number };
      expect(initialRows.count).toBe(150);

      // Updating with all 150 messages must retain all 150 rows (was wiped to 0 by chunked NOT IN)
      await updateConversation(conversation);

      const remainingRows = memoryDb
        .prepare("SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?")
        .get(convId) as { count: number };
      expect(remainingRows.count).toBe(150);
    });

    it("correctly prunes removed messages when updating a conversation with 150 messages (R01)", async () => {
      const convId = "conv-prune-150";
      const allMessages = Array.from({ length: 150 }, (_, i) => ({
        id: `msg-${i}`,
        role: "user" as const,
        content: `Message ${i}`,
        timestamp: 1000 + i,
      }));

      await createConversation({
        id: convId,
        title: "Prune Test",
        createdAt: 1000,
        updatedAt: 2000,
        messages: allMessages,
      });

      // Keep only first 140 messages (remove 10 messages)
      const keptMessages = allMessages.slice(0, 140);
      await updateConversation({
        id: convId,
        title: "Prune Test Updated",
        createdAt: 1000,
        updatedAt: 3000,
        messages: keptMessages,
      });

      const remainingRows = memoryDb
        .prepare("SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?")
        .get(convId) as { count: number };
      expect(remainingRows.count).toBe(140);

      const deletedRow = memoryDb
        .prepare("SELECT id FROM messages WHERE id = ?")
        .get("msg-145") as { id: string } | undefined;
      expect(deletedRow).toBeUndefined();
    });

    it("correctly handles conversations exceeding parameter limit (>900 messages) without wipe or error (R01)", async () => {
      const convId = "conv-950";
      const allMessages = Array.from({ length: 950 }, (_, i) => ({
        id: `msg-${i}`,
        role: "user" as const,
        content: `Message ${i}`,
        timestamp: 1000 + i,
      }));

      await createConversation({
        id: convId,
        title: "Large Conv",
        createdAt: 1000,
        updatedAt: 2000,
        messages: allMessages,
      });

      // Remove 5 messages
      const keptMessages = allMessages.slice(5);
      await updateConversation({
        id: convId,
        title: "Large Conv Updated",
        createdAt: 1000,
        updatedAt: 3000,
        messages: keptMessages,
      });

      const remainingRows = memoryDb
        .prepare("SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?")
        .get(convId) as { count: number };
      expect(remainingRows.count).toBe(945);
    });
  });

  describe("R26: migrateLocalStorageToSQLite partial migration safety", () => {
    it("preserves source localStorage key and does NOT mark migration complete on partial failure (R26)", async () => {
      const data = [
        {
          id: "conv-good",
          title: "Good Conversation",
          createdAt: 1000,
          updatedAt: 2000,
          messages: [{ id: "m-1", role: "user", content: "Hi", timestamp: 1000 }],
        },
        {
          id: "conv-bad",
          // missing title -> validateConversation fails
          createdAt: 1000,
          updatedAt: 2000,
          messages: [],
        },
      ];

      safeLocalStorage.setItem("chat_history", JSON.stringify(data));

      const result = await migrateLocalStorageToSQLite();

      expect(result.success).toBe(false);
      expect(result.migratedCount).toBe(1);
      expect(result.error).toContain("1 conversations failed to migrate");

      // Invariant: source must NOT be deleted, and completion flag must NOT be set
      expect(safeLocalStorage.getItem("chat_history")).toBe(JSON.stringify(data));
      expect(safeLocalStorage.getItem("chat_history_migrated_to_sqlite")).toBeNull();
    });

    it("clears source localStorage key and marks migration complete when all succeed (R26)", async () => {
      const data = [
        {
          id: "conv-ok-1",
          title: "Good Conversation 1",
          createdAt: 1000,
          updatedAt: 2000,
          messages: [{ id: "m-1", role: "user", content: "Hi", timestamp: 1000 }],
        },
      ];

      safeLocalStorage.setItem("chat_history", JSON.stringify(data));

      const result = await migrateLocalStorageToSQLite();

      expect(result.success).toBe(true);
      expect(result.migratedCount).toBe(1);
      expect(result.error).toBeUndefined();

      // Invariant: source cleared and completion flag set
      expect(safeLocalStorage.getItem("chat_history")).toBeNull();
      expect(safeLocalStorage.getItem("chat_history_migrated_to_sqlite")).toBe("true");
    });
  });

  describe("R27: getAllConversations parameter limit chunking", () => {
    it("chunks message queries in batches of <= 100 IDs and returns all conversations with messages (R27)", async () => {
      // Create 150 conversations with 1 message each
      for (let i = 0; i < 150; i++) {
        await createConversation({
          id: `conv-multi-${i}`,
          title: `Conv ${i}`,
          createdAt: 1000 + i,
          updatedAt: 2000 + i,
          messages: [
            {
              id: `msg-multi-${i}`,
              role: "user",
              content: `Hello ${i}`,
              timestamp: 1000 + i,
            },
          ],
        });
      }

      selectQueries = [];
      const result = await getAllConversations();

      expect(result.length).toBe(150);

      // Verify that message SELECT queries were chunked
      const messageSelects = selectQueries.filter((q) =>
        q.includes("SELECT * FROM messages WHERE conversation_id IN")
      );
      // For 150 conversations with MESSAGES_PER_QUERY = 100, there should be exactly 2 queries
      expect(messageSelects.length).toBe(2);

      // Verify returned shape
      const conv0 = result.find((c) => c.id === "conv-multi-0");
      expect(conv0?.messages.length).toBe(1);
      expect(conv0?.messages[0].id).toBe("msg-multi-0");
    });
  });
});
