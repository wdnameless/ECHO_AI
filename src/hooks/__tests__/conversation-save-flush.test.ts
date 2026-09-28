import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConversationStore } from "../useConversationStore";

/**
 * A pending debounced save must be flushed when the store unmounts.
 *
 * The meeting panel is opened and closed as the conversation comes and goes,
 * and every close unmounted this hook with a ~500ms debounce still pending. The
 * cleanup cleared the timer and returned — so the last thing said before closing
 * was never written to SQLite, with no retry, because nothing else knew the
 * conversation had changed.
 *
 * `saveConversation` is mocked at the module boundary; the assertion is on the
 * real hook's behaviour, which is what makes this fail against the old cleanup.
 */
const saveConversation = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib", () => ({
  saveConversation: (...args: unknown[]) => saveConversation(...args),
  CONVERSATION_SAVE_DEBOUNCE_MS: 20,
  generateConversationId: (p: string) => `${p}-1`,
  generateMessageId: () => "msg-1",
  generateConversationTitle: () => "title",
  filterFillers: (t: string) => t,
  getFillerFilterConfig: () => ({ filterFeedEnabled: false, customFillers: "" }),
}));

vi.mock("@/lib/vocab", () => ({
  applyCorrections: (t: string) => t,
  loadCorrections: async () => {},
}));

beforeEach(() => {
  saveConversation.mockClear();
});

describe("debounced save on unmount", () => {
  it("writes the last messages instead of dropping them", async () => {
    const { result, unmount } = renderHook(() => useConversationStore());

    // Give the store a conversation with content, then unmount inside the
    // debounce window — exactly what closing the panel does.
    act(() => {
      result.current.setConversation({
        id: "conv-flush",
        title: "t",
        createdAt: 1,
        updatedAt: 2,
        messages: [
          { id: "m1", role: "user", content: "последняя фраза", timestamp: 3 },
        ],
      });
    });

    unmount();

    // The write must have happened (async), not been cancelled.
    await vi.waitFor(() => expect(saveConversation).toHaveBeenCalled());
    const saved = saveConversation.mock.calls[0][0] as {
      id: string;
      messages: unknown[];
    };
    expect(saved.id).toBe("conv-flush");
    expect(saved.messages).toHaveLength(1);
  });
});
