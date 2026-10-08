import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@/lib/storage/secret-store", () => ({
  getSecret: vi.fn(async () => null),
  secretKey: { aiProvider: (id: string) => id },
}));
vi.mock("@/lib", () => ({
  getResponseSettings: () => ({ language: "ru" }),
  LANGUAGES: [],
}));
vi.mock("../web-search", () => ({
  getWebSearchSettings: () => ({ enabled: false }),
}));
vi.mock("@/lib/rag", () => ({
  getRagContext: () => null,
}));
vi.mock("@/lib/host-trust-gate", () => ({
  resolveOutboundHeaders: async (_url: string, headers: Record<string, string>) => ({
    allowed: true,
    headers,
    maxRedirections: 0,
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((chunk: string) => void) | null = null;
  },
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { fetchAIResponse } from "../ai-response.function";

describe("R01: Pluely API history order preservation", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (_cmd: string, args: { onEvent: { onmessage: (chunk: string) => void } }) => {
      args.onEvent.onmessage?.("response-chunk");
      args.onEvent.onmessage?.("\u{0}__DONE__\u{0}");
    });
  });

  it("passes conversation history in chronological order without reversal", async () => {
    const history = [
      { role: "user" as const, content: "First question: tell me about Redux" },
      { role: "assistant" as const, content: "First answer: Redux is a state management library" },
      { role: "user" as const, content: "Second question: what are reducers?" },
    ];

    const stream = fetchAIResponse({
      userMessage: "Third question: give an example",
      history,
    });

    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();

    expect(invokeMock).toHaveBeenCalledWith(
      "chat_stream_response",
      expect.objectContaining({
        userMessage: "Third question: give an example",
        history: expect.any(String),
      })
    );

    const callArgs = invokeMock.mock.calls.find((call) => call[0] === "chat_stream_response")?.[1];
    expect(callArgs).toBeDefined();

    const parsedHistory = JSON.parse(callArgs.history);
    expect(parsedHistory).toHaveLength(3);
    // Chronological order: oldest turns first, newest turns last
    expect(parsedHistory[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "First question: tell me about Redux" }],
    });
    expect(parsedHistory[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "First answer: Redux is a state management library" }],
    });
    expect(parsedHistory[2]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Second question: what are reducers?" }],
    });
  });
});
