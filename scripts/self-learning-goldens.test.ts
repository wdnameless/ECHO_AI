import { describe, it, expect, beforeEach } from "vitest";
import { GOLDEN_TEST_CASES } from "./self-learning-goldens.data";
import {
  addUserFact,
  buildSelfEvolutionPromptBlock,
  recordFeedback,
  resetLearning,
  setSelfLearningEnabled,
} from "../src/lib/storage/user-facts";

describe("T6: Deterministic Self-Learning Golden Cases", () => {
  beforeEach(async () => {
    localStorage.clear();
    setSelfLearningEnabled(true);
    await resetLearning();
  });

  for (const tc of GOLDEN_TEST_CASES) {
    it(`${tc.id}: ${tc.name}`, async () => {
      // 1. Initial prompt check (e.g. for case 6: verify no fabricated facts)
      const initialPrompt = buildSelfEvolutionPromptBlock();
      if (tc.forbiddenInPromptBlock) {
        for (const forbidden of tc.forbiddenInPromptBlock) {
          expect(initialPrompt).not.toContain(forbidden);
        }
      }

      // 2. Perform learning signal
      if (tc.feedback) {
        recordFeedback(
          tc.question1,
          tc.answer1,
          tc.feedback.rating,
          tc.feedback.reason
        );
      }
      if (tc.manualFact) {
        addUserFact(tc.manualFact.fact, tc.manualFact.category);
      }

      // 3. Prompt block after adaptation
      const adaptedPrompt = buildSelfEvolutionPromptBlock();

      // 4. Verify expected adaptation markers
      for (const expected of tc.expectedInPromptBlock) {
        expect(adaptedPrompt).toContain(expected);
      }
      if (tc.forbiddenInPromptBlock) {
        for (const forbidden of tc.forbiddenInPromptBlock) {
          expect(adaptedPrompt).not.toContain(forbidden);
        }
      }
    });
  }

  it("respects one-button toggle: returns empty prompt block when self-learning disabled", () => {
    recordFeedback("Вопрос", "Ответ", "dislike", "слишком сухо и как робот");
    expect(buildSelfEvolutionPromptBlock()).toContain("живой и тёплый");

    setSelfLearningEnabled(false);
    expect(buildSelfEvolutionPromptBlock()).toBe("");
  });
});
