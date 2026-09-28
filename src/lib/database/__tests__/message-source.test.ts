import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatConversation } from "@/types/completion";

/**
 * The speaker must survive a save/load round-trip.
 *
 * The live feed distinguishes the interviewer from the candidate, but the column
 * did not exist, so the fact was dropped on every reload: history came back with
 * `source` gone, which broke the LLM's `buildHistory` (it could no longer
 * attribute a line to a side) and hid speech rows in the feed after a restart.
 *
 * This drives the real `createConversation`/`getConversationById` against a fake
 * `db.execute`/`db.select`, so it fails if the column stops being written or read
 * — a test of a copied-out helper would pass either way.
 */
const executed: Array<{ sql: string; params: unknown[] }> = [];
const rows: Array<Record<string, unknown>> = [];

vi.mock("../config", () => ({
  getDatabase: async () => ({
    execute: async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params });
      // Record the message rows so the read below can return them.
      if (/INSERT INTO messages/i.test(sql)) {
        for (let i = 0; i < params.length; i += 7) {
          rows.push({
            id: params[i],
            conversation_id: params[i + 1],
            role: params[i + 2],
            content: params[i + 3],
            timestamp: params[i + 4],
            attached_files: params[i + 5],
            source: params[i + 6],
          });
        }
      }
      return { rowsAffected: 1 };
    },
    select: async (sql: string) => {
      if (/FROM conversations/i.test(sql)) {
        return [
          {
            id: "conv-1",
            title: "t",
            created_at: 1000,
            updated_at: 2000,
          },
        ];
      }
      if (/FROM messages/i.test(sql)) return rows;
      return [];
    },
  }),
}));

import { createConversation, getConversationById } from "../chat-history.action";

beforeEach(() => {
  executed.length = 0;
  rows.length = 0;
});

describe("message source persistence", () => {
  it("writes source and reads it back", async () => {
    const conv: ChatConversation = {
      id: "conv-1",
      title: "t",
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        { id: "m-1", role: "user", content: "вопрос", timestamp: 1100, source: "them" },
        { id: "m-2", role: "assistant", content: "ответ", timestamp: 1200 },
        { id: "m-3", role: "user", content: "моя реплика", timestamp: 1300, source: "me" },
      ],
    };

    await createConversation(conv);

    const insert = executed.find((e) => /INSERT INTO messages/i.test(e.sql));
    expect(insert?.sql).toContain("source");
    // The two known sides are carried through; a message with no side stays null
    // rather than being guessed.
    expect(insert?.params).toContain("them");
    expect(insert?.params).toContain("me");
    expect(insert?.params).toContain(null);

    const loaded = await getConversationById("conv-1");
    const byId = new Map(loaded?.messages.map((m) => [m.id, m]));
    expect(byId.get("m-1")?.source).toBe("them");
    expect(byId.get("m-3")?.source).toBe("me");
    // Absent, not "them": callers keep their own default for pre-migration rows.
    expect(byId.get("m-2")?.source).toBeUndefined();
  });

  it("narrows an unexpected stored value instead of leaking it", async () => {
    // The column is free-form TEXT; a value the app does not know must not reach
    // a field typed `"me" | "them"`.
    rows.push({
      id: "m-x",
      conversation_id: "conv-1",
      role: "user",
      content: "x",
      timestamp: 1100,
      attached_files: null,
      source: "something-else",
    });

    const loaded = await getConversationById("conv-1");
    expect(loaded?.messages[0]?.source).toBeUndefined();
  });
});
