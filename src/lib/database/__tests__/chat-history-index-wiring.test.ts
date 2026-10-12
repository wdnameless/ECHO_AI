import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveConversation } from "../chat-history.action";
import * as memoryIndex from "@/lib/rag/memory-index";
import type { ChatConversation } from "@/types";

const mockExecute = vi.fn();
const mockSelect = vi.fn();

vi.mock("../config", () => ({
  withWriteLock: (fn: () => unknown) => fn(),
  getDatabase: vi.fn().mockImplementation(() =>
    Promise.resolve({
      execute: mockExecute,
      select: mockSelect,
    })
  ),
}));

describe("P1-3 S1 wiring: indexTranscript on conversation save (R01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rowsAffected: 1 });
    mockSelect.mockResolvedValue([]);
  });

  it("calls indexTranscript with conversation segments when saveConversation is invoked", async () => {
    const indexSpy = vi.spyOn(memoryIndex, "indexTranscript").mockResolvedValue(undefined);

    const testConversation: ChatConversation = {
      id: "conv-test-wiring-1",
      title: "Architecture Review",
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "John discussed the streaming API architecture",
          timestamp: 1050,
        },
        {
          id: "msg-2",
          role: "assistant",
          content: "We agreed to use WebSockets routed through Rust",
          timestamp: 1100,
        },
      ],
    };

    await saveConversation(testConversation);

    expect(indexSpy).toHaveBeenCalledTimes(1);
    expect(indexSpy).toHaveBeenCalledWith(
      "conv-test-wiring-1",
      expect.arrayContaining([
        { text: "John discussed the streaming API architecture", ts: 1050 },
        { text: "We agreed to use WebSockets routed through Rust", ts: 1100 },
      ])
    );
  });
});
