import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportHistory, downloadBlob } from "../history-export";
import * as chatHistoryAction from "../chat-history.action";
import type { ChatConversation } from "@/types";

const mockConversations: ChatConversation[] = [
  {
    id: "conv-1",
    title: "First Conversation",
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    messages: [
      { id: "m-1", role: "user", content: "What is Pluely?", timestamp: 1700000000100, source: "me" },
      { id: "m-2", role: "assistant", content: "Pluely is an AI assistant.", timestamp: 1700000000200 },
    ],
  },
  {
    id: "conv-2",
    title: "Second Conversation",
    createdAt: 1700000002000,
    updatedAt: 1700000003000,
    messages: [
      { id: "m-3", role: "user", content: "How do I export chats?", timestamp: 1700000002100, source: "me" },
      { id: "m-4", role: "assistant", content: "Use the export button.", timestamp: 1700000002200 },
    ],
  },
];

describe("T4.3 History Export (R14: exportHistory)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(chatHistoryAction, "getAllConversations").mockResolvedValue(mockConversations);
  });

  it("exports all conversations to JSON with messages and metadata", async () => {
    const blob = await exportHistory("json");
    expect(blob.type).toBe("application/json");

    const text = await blob.text();
    const data = JSON.parse(text);

    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe("conv-1");
    expect(data[0].title).toBe("First Conversation");
    expect(data[0].createdAt).toBe(1700000000000);
    expect(data[0].messages).toHaveLength(2);
    expect(data[0].messages[0].content).toBe("What is Pluely?");
    expect(data[1].id).toBe("conv-2");
    expect(data[1].messages[0].content).toBe("How do I export chats?");
  });

  it("exports only selected conversations to JSON when conversationIds are provided", async () => {
    const blob = await exportHistory("json", ["conv-2"]);
    const text = await blob.text();
    const data = JSON.parse(text);

    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("conv-2");
    expect(data[0].title).toBe("Second Conversation");
  });

  it("exports all conversations to Markdown", async () => {
    const blob = await exportHistory("md");
    expect(blob.type).toBe("text/markdown");

    const text = await blob.text();
    expect(text).toContain("# First Conversation");
    expect(text).toContain("What is Pluely?");
    expect(text).toContain("Pluely is an AI assistant.");
    expect(text).toContain("# Second Conversation");
    expect(text).toContain("How do I export chats?");
  });

  it("exports only selected conversations to Markdown when conversationIds are provided", async () => {
    const blob = await exportHistory("md", ["conv-1"]);
    const text = await blob.text();

    expect(text).toContain("# First Conversation");
    expect(text).toContain("What is Pluely?");
    expect(text).not.toContain("# Second Conversation");
  });

  it("downloadBlob creates and triggers an anchor download", () => {
    const createObjectURLSpy = vi.fn().mockReturnValue("blob:test-url");
    const revokeObjectURLSpy = vi.fn();
    window.URL.createObjectURL = createObjectURLSpy;
    window.URL.revokeObjectURL = revokeObjectURLSpy;

    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === "a") {
        el.click = clickSpy;
      }
      return el;
    });

    const blob = new Blob(["test"], { type: "text/plain" });
    downloadBlob(blob, "test.md");

    expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:test-url");
  });
});
