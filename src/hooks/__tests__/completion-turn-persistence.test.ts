import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistConversationTurn } from "../useCompletionCommon";
import type { ChatConversation, ChatMessage } from "@/types";
import { getConversationById } from "@/lib";

const mockDb = new Map<string, ChatConversation>();

vi.mock("@/lib", () => ({
  generateMessageId: (role: string, ts: number) => `${role}-${ts}`,
  generateConversationTitle: (text: string) => `Title: ${text}`,
  getConversationById: vi.fn(async (id: string) => mockDb.get(id) || null),
  saveConversation: vi.fn(async (conv: ChatConversation) => {
    mockDb.set(conv.id, conv);
  }),
  MESSAGE_ID_OFFSET: 1,
}));

beforeEach(() => {
  mockDb.clear();
  vi.clearAllMocks();
});

describe("persistConversationTurn message integrity", () => {
  it("does not lose earlier completed pairs when a subsequent turn passes stale empty existingMessages", async () => {
    // Turn 1 saves
    await persistConversationTurn({
      conversationId: "conv-1",
      lookupExistingId: "conv-1",
      existingMessages: [],
      userMessage: "Question 1",
      assistantResponse: "Answer 1",
      timestamp: 1000,
      preferNewTitleWhenEmpty: true,
    });

    const storedAfterTurn1 = mockDb.get("conv-1");
    expect(storedAfterTurn1).toBeDefined();
    expect(storedAfterTurn1!.messages).toHaveLength(2);
    expect(storedAfterTurn1!.title).toBe("Title: Question 1");

    // Turn 2 runs but caller React state had not refreshed existingMessages yet (stale empty array)
    await persistConversationTurn({
      conversationId: "conv-1",
      lookupExistingId: "conv-1",
      existingMessages: [], // stale
      userMessage: "Question 2",
      assistantResponse: "Answer 2",
      timestamp: 2000,
      preferNewTitleWhenEmpty: true,
    });

    const storedAfterTurn2 = mockDb.get("conv-1");
    expect(storedAfterTurn2).toBeDefined();
    // Must contain both Turn 1 and Turn 2 messages: 4 total
    expect(storedAfterTurn2!.messages).toHaveLength(4);
    expect(storedAfterTurn2!.messages.map((m: ChatMessage) => m.content)).toEqual([
      "Question 1",
      "Answer 1",
      "Question 2",
      "Answer 2",
    ]);
    // Must keep original title from Turn 1
    expect(storedAfterTurn2!.title).toBe("Title: Question 1");
  });

  it("finds existing conversation using conversationId even if lookupExistingId is null", async () => {
    // Initial record
    mockDb.set("conv-existing", {
      id: "conv-existing",
      title: "Existing Title",
      messages: [
        { id: "user-1", role: "user", content: "Initial Q", timestamp: 100 },
        { id: "assistant-2", role: "assistant", content: "Initial A", timestamp: 101 },
      ],
      createdAt: 100,
      updatedAt: 101,
    });

    await persistConversationTurn({
      conversationId: "conv-existing",
      lookupExistingId: null, // lookup was null
      existingMessages: [],
      userMessage: "Next Q",
      assistantResponse: "Next A",
      timestamp: 500,
      preferNewTitleWhenEmpty: true,
    });

    const updated = mockDb.get("conv-existing");
    expect(updated!.messages).toHaveLength(4);
    expect(updated!.title).toBe("Existing Title");
  });

  it("preserves durable history and reports failure when it cannot read the stored record", async () => {
    mockDb.set("unreadable", {
      id: "unreadable", title: "Durable conversation", createdAt: 1, updatedAt: 2,
      messages: [
        { id: "old-q", role: "user", content: "Earlier question", timestamp: 1 },
        { id: "old-a", role: "assistant", content: "Earlier answer", timestamp: 2 },
      ],
    });
    const failure = new Error("History temporarily unavailable");
    vi.mocked(getConversationById).mockRejectedValueOnce(failure);
    await expect(persistConversationTurn({
      conversationId: "unreadable", lookupExistingId: "unreadable", existingMessages: [],
      userMessage: "New question", assistantResponse: "New answer", timestamp: 3,
    })).rejects.toBe(failure);
    expect(mockDb.get("unreadable")?.messages.map((message) => message.content)).toEqual([
      "Earlier question", "Earlier answer",
    ]);
  });
});
