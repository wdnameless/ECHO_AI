import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  shouldOfferVisual,
  extractMermaidBlocks,
  VISUAL_PROMPT_HINT,
} from "@/lib/visual-answers";
import { buildEnhancedSystemPrompt } from "@/lib/functions/ai-response.function";
import { setActiveProfileId, INTERVIEW_PROFILE_ID, GENERAL_PROFILE_ID } from "@/lib/storage/prompt-profiles";
import { setAnswerMode } from "@/lib/answer-mode";
import * as humanizerRules from "@/config/humanizer.rules";

describe("visual-answers: shouldOfferVisual trigger matrix", () => {
  describe("eligible profiles with visual/architecture questions", () => {
    it.each([
      ["profile-interview", "спроектируй URL-shortener"],
      ["profile-interview", "спроектируй систему бронирования билетов"],
      ["profile-interview", "покажи архитектуру Uber"],
      ["profile-interview", "нарисуй схему авторизации OAuth2"],
      ["profile-interview", "покажи схему потока данных"],
      ["profile-interview", "диаграмма последовательности для платежного шлюза"],
      ["profile-interview", "пайплайн обработки видео"],
      ["profile-interview", "design a URL shortener"],
      ["profile-interview", "system design for Twitter"],
      ["profile-interview", "show the data flow between microservices"],
      ["profile-interview", "draw a sequence diagram for user login"],
      ["profile-interview", "show the component diagram for the backend"],
      ["profile-livecode", "спроектируй URL-shortener"],
      ["profile-livecode", "design a rate limiter"],
      ["profile-livecode", "draw the architecture of this cache"],
      ["interview", "system design of Netflix"],
      ["livecode", "спроектируй распределенный кэш"],
    ])("returns true for %s with question: %s", (profileId, question) => {
      expect(shouldOfferVisual(profileId, question)).toBe(true);
    });
  });

  describe("eligible profiles with non-visual/plain questions", () => {
    it.each([
      ["profile-interview", "Что такое deadlock?"],
      ["profile-interview", "Расскажи о себе"],
      ["profile-interview", "How does quicksort work?"],
      ["profile-interview", "What is polymorphism?"],
      ["profile-interview", "Объясни разницу между процессами и потоками"],
      ["profile-interview", "What are HTTP status codes?"],
      ["profile-interview", "Explain the event loop in Node.js"],
      ["profile-interview", "Напиши функцию разворота строки"],
      ["profile-interview", ""],
      ["profile-interview", "   "],
      ["profile-livecode", "How do indexes work in Postgres?"],
      ["profile-livecode", "Explain binary search"],
    ])("returns false for %s with plain question: %s", (profileId, question) => {
      expect(shouldOfferVisual(profileId, question)).toBe(false);
    });
  });

  describe("ineligible profiles with design/visual questions", () => {
    it.each([
      ["profile-general", "спроектируй URL-shortener"],
      ["profile-general", "design a URL shortener"],
      ["profile-sales", "спроектируй систему бронирования"],
      ["profile-recruiting", "system design for Twitter"],
      ["profile-lecture", "покажи архитектуру микросервисов"],
      ["profile-call-center", "draw a sequence diagram"],
      ["", "design a URL shortener"],
      ["unknown", "спроектируй URL-shortener"],
    ])("returns false for ineligible profile %s", (profileId, question) => {
      expect(shouldOfferVisual(profileId, question)).toBe(false);
    });
  });
});

describe("visual-answers: extractMermaidBlocks", () => {
  it("extracts closed mermaid fence", () => {
    const md = `Here is the architecture:
\`\`\`mermaid
graph TD
    A[Client] --> B[Load Balancer]
    B --> C[API Server]
\`\`\`
Follow-up explanation.`;

    const blocks = extractMermaidBlocks(md);
    expect(blocks).toEqual([
      "graph TD\n    A[Client] --> B[Load Balancer]\n    B --> C[API Server]",
    ]);
  });

  it("extracts multiple mermaid fences", () => {
    const md = `Block 1:
\`\`\`mermaid
graph LR
    A --> B
\`\`\`
Block 2:
\`\`\`mermaid
sequenceDiagram
    Alice->>Bob: Hello
\`\`\``;

    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toBe("graph LR\n    A --> B");
    expect(blocks[1]).toBe("sequenceDiagram\n    Alice->>Bob: Hello");
  });

  it("extracts unclosed mermaid fence (streaming edge case)", () => {
    const md = `Streaming in progress...
\`\`\`mermaid
graph TD
    Client --> Gateway
    Gateway --> Service`;

    const blocks = extractMermaidBlocks(md);
    expect(blocks).toEqual([
      "graph TD\n    Client --> Gateway\n    Gateway --> Service",
    ]);
  });

  it("ignores non-mermaid code blocks", () => {
    const md = `\`\`\`typescript
const x = 42;
\`\`\`
\`\`\`mermaid
graph TD
    X --> Y
\`\`\`
\`\`\`python
print("done")
\`\`\``;

    const blocks = extractMermaidBlocks(md);
    expect(blocks).toEqual(["graph TD\n    X --> Y"]);
  });

  it("returns empty array for plain markdown with no diagrams", () => {
    expect(extractMermaidBlocks("Just plain text with no code")).toEqual([]);
    expect(extractMermaidBlocks("")).toEqual([]);
  });

  it("ignores empty mermaid fences", () => {
    expect(extractMermaidBlocks("```mermaid\n```")).toEqual([]);
    expect(extractMermaidBlocks("```mermaid\n")).toEqual([]);
  });
});

describe("visual-answers: prompt hint injection and byte-identical non-visual prompts", () => {
  beforeEach(() => {
    setAnswerMode("interview");
    setActiveProfileId(INTERVIEW_PROFILE_ID);
  });

  it("injects VISUAL_PROMPT_HINT when shouldOfferVisual is true", async () => {
    const prompt = await buildEnhancedSystemPrompt(
      "Base prompt",
      "спроектируй URL-shortener",
      "interview",
      INTERVIEW_PROFILE_ID
    );
    expect(prompt).toContain(VISUAL_PROMPT_HINT);
  });

  it("does NOT inject VISUAL_PROMPT_HINT for plain questions (byte-identical prompt)", async () => {
    // Run with plain question
    const promptWithVisualOff = await buildEnhancedSystemPrompt(
      "Base prompt",
      "Что такое deadlock?",
      "interview",
      INTERVIEW_PROFILE_ID
    );

    expect(promptWithVisualOff).not.toContain(VISUAL_PROMPT_HINT);

    // Verify it doesn't contain any visual diagram text
    expect(promptWithVisualOff).not.toContain("VISUAL DIAGRAM RULE");
  });

  it("preserves byte-identical output for non-visual questions across runs", async () => {
    const openerSpy = vi
      .spyOn(humanizerRules, "pickAnswerOpener")
      .mockReturnValue("Давайте разберем.");
    try {
      const question = "Что такое deadlock?";
      const prompt1 = await buildEnhancedSystemPrompt(
        "Base prompt",
        question,
        "interview",
        INTERVIEW_PROFILE_ID
      );
      const prompt2 = await buildEnhancedSystemPrompt(
        "Base prompt",
        question,
        "interview",
        INTERVIEW_PROFILE_ID
      );

      expect(prompt1).toBe(prompt2);
    } finally {
      openerSpy.mockRestore();
    }
  });

  it("does not inject VISUAL_PROMPT_HINT when profile is general, even for design question", async () => {
    const prompt = await buildEnhancedSystemPrompt(
      "Base prompt",
      "спроектируй URL-shortener",
      "interview",
      GENERAL_PROFILE_ID
    );
    expect(prompt).not.toContain(VISUAL_PROMPT_HINT);
  });
});
