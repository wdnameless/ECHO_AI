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

  it("queries getRagContext and searchMemory concurrently in ONE Promise.all (R03)", async () => {
    vi.useFakeTimers();
    localStorage.setItem(STORAGE_KEYS.RAG_RESUME_ENABLED, "true");
    localStorage.setItem(STORAGE_KEYS.RAG_MEMORY_ENABLED, "true");

    let resumeStarted = false;
    let memoryStarted = false;

    vi.spyOn(rag, "getRagContext").mockImplementation(async () => {
      resumeStarted = true;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      return {
        id: "resume",
        type: "resume",
        content: "Senior Engineer",
        sourceName: "resume.pdf",
        updatedAt: 1000,
      };
    });

    vi.spyOn(rag, "searchMemory").mockImplementation(async () => {
      memoryStarted = true;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      return [
        {
          conversationId: "meeting-1",
          chunkId: "c1",
          score: 0.8,
          text: "Meeting notes",
        },
      ];
    });

    const promptPromise = buildEnhancedSystemPrompt("base", "user query");

    // Both requests must be initiated in parallel before the 100ms timer elapses
    await Promise.resolve();
    expect(resumeStarted).toBe(true);
    expect(memoryStarted).toBe(true);

    // Advancing 100ms finishes both parallel queries (total time is max, not sum)
    await vi.advanceTimersByTimeAsync(100);
    const prompt = await promptPromise;
    expect(prompt).toContain("Senior Engineer");
    expect(prompt).toContain("Meeting notes");

    vi.useRealTimers();
  });

  it("reads style preferences synchronously from cache without awaiting SQLite 400ms timeout (R03)", async () => {
    vi.useFakeTimers();
    localStorage.setItem("pluely:self-learning-enabled", "true");

    let finished = false;
    const promptPromise = buildEnhancedSystemPrompt("base", "query").then((res) => {
      finished = true;
      return res;
    });

    // Must complete synchronously without waiting for 400ms DB race
    await vi.advanceTimersByTimeAsync(10);
    expect(finished).toBe(true);
    const prompt = await promptPromise;
    expect(prompt).toBeTruthy();

    vi.useRealTimers();
  });

  it("enforces memory threshold boundary: excludes score < 0.45, includes score >= 0.45 (R13)", async () => {
    vi.spyOn(rag, "searchMemory").mockResolvedValueOnce([
      {
        conversationId: "m-low",
        chunkId: "c-low",
        score: 0.44,
        text: "Standup notes about unrelated coffee machine",
      },
      {
        conversationId: "m-high",
        chunkId: "c-high",
        score: 0.45,
        text: "Architecture discussion on distributed transactions",
      },
    ]);

    const prompt = await buildEnhancedSystemPrompt("base prompt", "How do transactions work?");

    expect(prompt).not.toContain("Standup notes about unrelated coffee machine");
    expect(prompt).toContain("Architecture discussion on distributed transactions");
  });

  it("filters out irrelevant memory hits with score 0.08 (R13)", async () => {
    vi.spyOn(rag, "searchMemory").mockResolvedValueOnce([
      {
        conversationId: "m-irrelevant",
        chunkId: "c-irr",
        score: 0.08,
        text: "Standup comedy joke from past meeting",
      },
    ]);

    const prompt = await buildEnhancedSystemPrompt("base prompt", "What is V8 GC?");

    expect(prompt).not.toContain("Standup comedy joke");
    expect(prompt).not.toContain("[CONTEXT: RELEVANT PAST MEETINGS]");
  });
});
