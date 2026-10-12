import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildEnhancedSystemPrompt } from "../ai-response.function";
import { STORAGE_KEYS } from "@/config/constants";
import * as rag from "@/lib/rag";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

vi.mock("@/lib", () => ({
  getResponseSettings: () => ({ length: "short", language: "ru" }),
  RESPONSE_LENGTHS: [{ id: "short", label: "Short", prompt: "" }],
  LANGUAGES: [{ id: "ru", label: "Russian", prompt: "" }],
}));

vi.mock("../web-search", () => ({
  getWebSearchSettings: () => ({ enabled: false }),
  performWebSearch: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/host-trust-gate", () => ({
  resolveOutboundHeaders: async () => ({
    allowed: true,
    headers: {},
  }),
}));

describe("ai-response RAG memory injection (R01, R04)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("injects relevant past meeting context when natural language query matches past meeting", async () => {
    vi.spyOn(rag, "searchMemory").mockResolvedValueOnce([
      {
        conversationId: "meeting-john-api",
        chunkId: "meeting-john-api:0",
        score: 0.88,
        text: "John discussed the API contract and GraphQL endpoints during the review.",
      },
    ]);

    const prompt = await buildEnhancedSystemPrompt(
      "system prompt",
      "Что Джон говорил про API?",
      undefined
    );

    expect(prompt).toContain("[CONTEXT: RELEVANT PAST MEETINGS]");
    expect(prompt).toContain("[MEETING CONVERSATION: meeting-john-api]");
    expect(prompt).toContain("John discussed the API contract and GraphQL endpoints");
  });

  it("preserves byte-identical resume and job context while RAG memory is active", async () => {
    localStorage.setItem(STORAGE_KEYS.RAG_RESUME_ENABLED, "true");
    localStorage.setItem(STORAGE_KEYS.RAG_JOB_ENABLED, "true");

    vi.spyOn(rag, "getRagContext").mockImplementation(async (type) => {
      if (type === "resume") {
        return {
          id: "resume",
          type: "resume",
          content: "Senior Backend Engineer with 8 years of Rust and TS experience",
          sourceName: "resume.pdf",
          updatedAt: 1000,
        };
      }
      if (type === "job") {
        return {
          id: "job",
          type: "job",
          content: "Looking for an architect to design real-time systems",
          sourceName: "job.docx",
          updatedAt: 2000,
        };
      }
      return null;
    });

    vi.spyOn(rag, "searchMemory").mockResolvedValueOnce([
      {
        conversationId: "m-prev",
        chunkId: "m-prev:0",
        score: 0.75,
        text: "Past discussion on database scaling.",
      },
    ]);

    const prompt = await buildEnhancedSystemPrompt(
      "base prompt",
      "Tell me about scaling",
      undefined
    );

    // Resume block is present and unchanged
    expect(prompt).toContain(
      "[CONTEXT: MY RESUME]\nSenior Backend Engineer with 8 years of Rust and TS experience\n[/CONTEXT]"
    );

    // Job block is present and unchanged
    expect(prompt).toContain(
      "[CONTEXT: JOB DESCRIPTION]\nLooking for an architect to design real-time systems\n[/CONTEXT]"
    );

    // Meeting memory block is also present
    expect(prompt).toContain("[CONTEXT: RELEVANT PAST MEETINGS]");
    expect(prompt).toContain("Past discussion on database scaling.");
  });

  it("omits meeting memory block when memory search yields no hits or low score", async () => {
    vi.spyOn(rag, "searchMemory").mockResolvedValueOnce([]);

    const prompt = await buildEnhancedSystemPrompt(
      "base prompt",
      "What is the weather?",
      undefined
    );

    expect(prompt).not.toContain("[CONTEXT: RELEVANT PAST MEETINGS]");
  });
});
