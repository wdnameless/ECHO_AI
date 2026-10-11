import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DatabaseSync, type SupportedValueType } from "node:sqlite";
import {
  createConversation,
  updateConversation,
  getAllConversations,
  migrateLocalStorageToSQLite,
} from "../chat-history.action";
import { runRetentionCleanup } from "@/lib/retention";
import type { ChatConversation } from "@/types";
import { safeLocalStorage } from "@/lib";
import monotonicTimestampMigration from "../../../../src-tauri/src/db/migrations/monotonic-conversation-timestamp.sql?raw";

let memoryDb: DatabaseSync;
let selectQueries: string[] = [];
let afterExecute: ((query: string) => Promise<void>) | null = null;

vi.mock("../config", () => ({
  getDatabase: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      execute: async (query: string, params: unknown[] = []) => {
        const stmt = memoryDb.prepare(query);
        const values = params as SupportedValueType[];
        const result = /\$\d+\b/.test(query)
          ? stmt.run(Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value])))
          : stmt.run(...values);
        await afterExecute?.(query);
        return { rowsAffected: Number(result.changes) };
      },
      select: async <T>(query: string, params: unknown[] = []): Promise<T> => {
        selectQueries.push(query);
        const stmt = memoryDb.prepare(query);
        const values = params as SupportedValueType[];
        const rows = /\$\d+\b/.test(query)
          ? stmt.all(Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value])))
          : stmt.all(...values);
        return rows as unknown as T;
      },
    });
  }),
}));

describe("chat-history actions audit fixes (R01, R02, R26, R27)", () => {
  beforeEach(() => {
    selectQueries = [];
    afterExecute = null;
    safeLocalStorage.removeItem("chat_history");
    safeLocalStorage.removeItem("chat_history_migrated_to_sqlite");

    memoryDb = new DatabaseSync(":memory:");
    memoryDb.exec(`
      PRAGMA foreign_keys = ON;
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
        attached_files TEXT,
        -- Mirrors migration 7 in src-tauri/src/db/migrations/message-source.sql.
        source TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
    `);
    memoryDb.exec(monotonicTimestampMigration);
  });
  afterEach(() => { memoryDb.close(); });

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

  describe("Interleaved retention cleanup and monotonic triggers", () => {
    it("preserves active conversation and its messages across batched update interleaved with retention cleanup", async () => {
      const now = 1_700_000_000_000;
      const fortyDaysMs = 40 * 24 * 60 * 60 * 1000;
      const oldTimestamp = now - fortyDaysMs;

      // Create an initial conversation with 60 messages: 50 from 40 days ago, 10 fresh
      const messages = [
        ...Array.from({ length: 50 }, (_, i) => ({
          id: `hist-${i}`,
          role: "user" as const,
          content: `Old query ${i}`,
          timestamp: oldTimestamp + i * 1000,
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `fresh-${i}`,
          role: "assistant" as const,
          content: `Fresh reply ${i}`,
          timestamp: now - 5000 + i * 100,
        })),
      ];

      const conv: ChatConversation = {
        id: "conv-active-interleaved",
        title: "Active Chat",
        createdAt: oldTimestamp,
        updatedAt: now,
        messages,
      };

      await createConversation(conv);

      const updatedConv = { ...conv, title: "Active Chat Renamed", updatedAt: now };
      let interleaved = false;
      afterExecute = async (query) => {
        if (!interleaved && /^INSERT.*INTO\s+messages\b/i.test(query)) {
          interleaved = true;
          await runRetentionCleanup(30, now);
        }
      };
      await updateConversation(updatedConv);
      expect(interleaved).toBe(true);

      // Conversation and all 60 messages survive
      const all = await getAllConversations();
      const active = all.find((c) => c.id === "conv-active-interleaved");
      expect(active).toBeDefined();
      expect(active?.title).toBe("Active Chat Renamed");
      expect(active?.messages.length).toBe(60);
    });

    it("does not expose an empty revived parent between retention deletion phases", async () => {
      const now = 1_700_000_000_000;
      const oldTimestamp = now - 40 * 24 * 60 * 60 * 1000;
      await createConversation({
        id: "expired", title: "Expired conversation", createdAt: oldTimestamp, updatedAt: oldTimestamp,
        messages: [
          { id: "old-q", role: "user", content: "Old question", timestamp: oldTimestamp },
          { id: "old-a", role: "assistant", content: "Old answer", timestamp: oldTimestamp + 1 },
        ],
      });
      let attempted = false;
      let revived = false;
      afterExecute = async (query) => {
        if (!attempted && /^DELETE\b/i.test(query)) {
          attempted = true;
          try {
            memoryDb.prepare("INSERT INTO messages (id,conversation_id,role,content,timestamp) VALUES ('new','expired','user','Concurrent message',?)").run(now);
            revived = true;
          } catch {
            // Once the atomic parent deletion commits, a writer must see missing-parent failure.
          }
        }
      };
      const result = await runRetentionCleanup(30, now);
      expect(attempted).toBe(true);
      expect(result.deletedConversations).toBe(1);
      expect(revived).toBe(false);
      expect(await getAllConversations()).toEqual([]);
      expect(memoryDb.prepare("SELECT count(*) AS count FROM messages").get()?.count).toBe(0);
    });

  });
});
