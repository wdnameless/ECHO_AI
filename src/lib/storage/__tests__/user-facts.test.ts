import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getUserFacts,
  addUserFact,
  getUserStylePreferences,
  getFeedbackLog,
  recordFeedback,
  buildSelfEvolutionPromptBlock,
  isSelfLearningEnabled,
  setSelfLearningEnabled,
  resetLearning,
  getLearningProfile,
  LANGUAGE_RULE,
  SELF_LEARNING_STORAGE_KEY,
  type LearningProfile,
} from "../user-facts";
import {
  restoreSelfEvolution,
} from "@/lib/self-evolution-persist";
import { buildEnhancedSystemPrompt } from "@/lib/functions/ai-response.function";

// In-memory SQLite mock
const mockExecute = vi.fn();
const mockSelect = vi.fn();

vi.mock("@/lib/database/config", () => ({
  getDatabase: vi.fn().mockImplementation(() =>
    Promise.resolve({
      execute: mockExecute,
      select: mockSelect,
    })
  ),
}));

describe("Self-Learning Core & user-facts (T1-T4)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rowsAffected: 1 });
    mockSelect.mockResolvedValue([]);
  });

  describe("T1: Честный пустой профиль (R01, R03, R09i)", () => {
    it("getUserFacts() returns empty array [] by default, never invented Senior facts", () => {
      const facts = getUserFacts();
      expect(facts).toEqual([]);
      expect(facts.length).toBe(0);
    });

    it("buildSelfEvolutionPromptBlock() returns empty string for brand new user with no history", () => {
      // Default enabled, but no history, no facts, no feedback
      expect(isSelfLearningEnabled()).toBe(true);
      const promptBlock = buildSelfEvolutionPromptBlock();
      expect(promptBlock).toBe("");
      expect(promptBlock).not.toContain("Senior");
      expect(promptBlock).not.toContain("Team Lead");
    });

    it("getLearningProfile() returns typed LearningProfile with empty facts", () => {
      const profile: LearningProfile = getLearningProfile();
      expect(profile).toBeDefined();
      expect(profile.facts).toEqual([]);
      expect(profile.rules).toEqual([]);
      expect(profile.style).toBeDefined();
    });
  });

  describe("T2: Единый тумблер ВКЛ/ВЫКЛ (R02, R04, R05)", () => {
    it("isSelfLearningEnabled() defaults to true", () => {
      expect(localStorage.getItem(SELF_LEARNING_STORAGE_KEY)).toBeNull();
      expect(isSelfLearningEnabled()).toBe(true);
    });

    it("setSelfLearningEnabled updates status in storage", () => {
      setSelfLearningEnabled(false);
      expect(isSelfLearningEnabled()).toBe(false);
      expect(localStorage.getItem(SELF_LEARNING_STORAGE_KEY)).toBe("false");

      setSelfLearningEnabled(true);
      expect(isSelfLearningEnabled()).toBe(true);
      expect(localStorage.getItem(SELF_LEARNING_STORAGE_KEY)).toBe("true");
    });

    it("recordFeedback does not record or alter style when disabled", () => {
      setSelfLearningEnabled(false);
      const entry = recordFeedback(
        "Что такое React?",
        "React это библиотека...",
        "dislike",
        "нумерованные списки"
      );

      expect(entry.id).toBe("noop");
      expect(getFeedbackLog()).toEqual([]);
      const style = getUserStylePreferences();
      expect(style.avoidPatterns).not.toContain("нумерованные списки");
      // SQLite mirror should not be called
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("buildSelfEvolutionPromptBlock returns empty string when disabled even if history exists", () => {
      addUserFact("Учит Go", "preference");
      expect(getUserFacts().length).toBe(1);

      // When enabled, it would produce a prompt block
      setSelfLearningEnabled(true);
      expect(buildSelfEvolutionPromptBlock()).toContain("Учит Go");

      // When disabled, returns empty string
      setSelfLearningEnabled(false);
      expect(buildSelfEvolutionPromptBlock()).toBe("");
    });
  });

  describe("T3: Источник правды SQLite + сброс обоих хранилищ (R10i)", () => {
    it("resetLearning cleans both localStorage and SQLite", async () => {
      // Seed localStorage
      addUserFact("Работает с Rust", "role");
      setSelfLearningEnabled(true);
      recordFeedback("Вопрос", "Ответ", "like");

      expect(getUserFacts().length).toBeGreaterThan(0);
      expect(getFeedbackLog().length).toBeGreaterThan(0);

      // Call resetLearning
      await resetLearning();

      // localStorage should be clean
      expect(getUserFacts()).toEqual([]);
      expect(getFeedbackLog()).toEqual([]);
      expect(getUserStylePreferences().avoidPatterns).toEqual([]);
      expect(getUserStylePreferences().favoritePatterns).toEqual([]);
      expect(buildSelfEvolutionPromptBlock()).toBe("");

      // SQLite cleanup was triggered
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM se_feedback_log")
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM se_style")
      );
    });

    it("restoreSelfEvolution restores profile from SQLite into empty cache", async () => {
      // Simulate empty localStorage
      expect(getFeedbackLog()).toEqual([]);
      expect(getUserStylePreferences().avoidPatterns).toEqual([]);

      // Simulate SQLite having learned data
      mockSelect.mockImplementation((query: string) => {
        if (query.includes("se_feedback_log")) {
          return Promise.resolve([
            {
              id: "fb-1",
              question: "Как дела?",
              response: "Хорошо",
              rating: "dislike",
              reason: "списки",
              topic: "general",
              timestamp: 1000,
            },
          ]);
        }
        if (query.includes("se_style")) {
          return Promise.resolve([
            {
              tone: "живой и краткий",
              preferred_length: "concise",
              favorite_patterns: JSON.stringify(["Пример хорошего ответа"]),
              avoid_patterns: JSON.stringify(["списки"]),
              custom_rules: JSON.stringify(["Без воды"]),
            },
          ]);
        }
        return Promise.resolve([]);
      });

      await restoreSelfEvolution();

      // Check that localStorage now has the restored state
      const restoredLogs = getFeedbackLog();
      expect(restoredLogs.length).toBe(1);
      expect(restoredLogs[0].reason).toBe("списки");

      const restoredStyle = getUserStylePreferences();
      expect(restoredStyle.tone).toBe("живой и краткий");
      expect(restoredStyle.avoidPatterns).toContain("списки");
      expect(restoredStyle.favoritePatterns).toContain("Пример хорошего ответа");
      expect(restoredStyle.customRules).toContain("Без воды");
    });
  });

  describe("T4: Языковое правило отдельно, всегда (R07, R11i)", () => {
    it("LANGUAGE_RULE is exported and NOT contained in buildSelfEvolutionPromptBlock", () => {
      expect(LANGUAGE_RULE).toBeDefined();
      expect(LANGUAGE_RULE).toContain("Отвечай ТОЛЬКО на русском или английском");

      // Give some history so evolution block is non-empty
      addUserFact("Python dev", "role");
      setSelfLearningEnabled(true);
      const promptBlock = buildSelfEvolutionPromptBlock();
      expect(promptBlock).toContain("Python dev");
      // The language rule should NOT be inside the self-evolution block itself
      expect(promptBlock).not.toContain("ЖЁСТКОЕ ПРАВИЛО ЯЗЫКА");
    });

    it("buildEnhancedSystemPrompt applies LANGUAGE_RULE even when self-learning is disabled", async () => {
      setSelfLearningEnabled(false);
      addUserFact("Java dev", "role");

      const prompt = await buildEnhancedSystemPrompt(
        undefined,
        "Привет, как жизнь?"
      );

      // Language rule MUST be present
      expect(prompt).toContain("Отвечай ТОЛЬКО на русском или английском");
      // Self-evolution block MUST NOT be present
      expect(prompt).not.toContain("Java dev");
      expect(prompt).not.toContain("SELF-EVOLUTION ADAPTIVE PROFILE");
    });

    it("buildEnhancedSystemPrompt applies both LANGUAGE_RULE and evolution block when enabled", async () => {
      setSelfLearningEnabled(true);
      addUserFact("TypeScript dev", "role");

      // Mock DB style for getStyleFromDbOrCache
      mockSelect.mockImplementation((query: string) => {
        if (query.includes("se_style")) {
          return Promise.resolve([
            {
              tone: "профессиональный",
              preferred_length: "concise",
              favorite_patterns: "[]",
              avoid_patterns: "[]",
              custom_rules: "[]",
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const prompt = await buildEnhancedSystemPrompt(
        undefined,
        "Привет, как жизнь?"
      );

      // Both must be present
      expect(prompt).toContain("Отвечай ТОЛЬКО на русском или английском");
      expect(prompt).toContain("TypeScript dev");
      expect(prompt).toContain("SELF-EVOLUTION ADAPTIVE PROFILE");
    });
  });
});
