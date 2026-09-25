import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  upsertUtterance,
  finalizeUtterance,
  selectRussianFiller,
  selectFillerForText,
  resetRecentFillers,
  detectTextLanguage,
  RUSSIAN_FILLERS,
  RUSSIAN_INTERVIEW_FILLERS,
  ENGLISH_FILLERS,
  isExplicitAskEligible,
  type TranscriptUtterance,
} from "../transcript-stabilizer";

describe("transcript-stabilizer", () => {
  beforeEach(() => {
    resetRecentFillers();
  });

  it("creates a new partial utterance and keeps stable id during streaming updates", () => {
    let list: TranscriptUtterance[] = [];
    const first = upsertUtterance(list, {
      source: "them",
      text: "Hello",
      partial: true,
      timestamp: 1000,
    });

    expect(first.list).toHaveLength(1);
    expect(first.list[0].text).toBe("Hello");
    expect(first.list[0].partial).toBe(true);
    const stableId = first.activeId;

    const second = upsertUtterance(first.list, {
      source: "them",
      text: "Hello world, what is your experience with React?",
      partial: true,
      currentActiveId: stableId,
      timestamp: 1050,
    });

    expect(second.list).toHaveLength(1);
    expect(second.activeId).toBe(stableId);
    expect(second.list[0].id).toBe(stableId);
    expect(second.list[0].text).toBe("Hello world, what is your experience with React?");
    expect(second.list[0].partial).toBe(true);

    const finalized = finalizeUtterance(second.list, stableId);
    expect(finalized).toHaveLength(1);
    expect(finalized[0].id).toBe(stableId);
    expect(finalized[0].partial).toBe(false);
  });

  it("handles multiple channels (them and me) independently without ID conflicts", () => {
    let list: TranscriptUtterance[] = [];
    const themRes = upsertUtterance(list, {
      source: "them",
      text: "Can you explain closures?",
      partial: false,
    });

    const meRes = upsertUtterance(themRes.list, {
      source: "me",
      text: "Sure, a closure is a function bundled with its lexical environment.",
      partial: true,
    });

    expect(meRes.list).toHaveLength(2);
    expect(meRes.list[0].source).toBe("them");
    expect(meRes.list[1].source).toBe("me");
    expect(meRes.list[0].id).not.toBe(meRes.list[1].id);
  });

  it("selects valid Russian interview fillers", () => {
    const filler1 = selectRussianFiller(0);
    const filler2 = selectRussianFiller("test-seed");
    expect(RUSSIAN_INTERVIEW_FILLERS).toContain(filler1);
    expect(RUSSIAN_INTERVIEW_FILLERS).toContain(filler2);
    expect(filler1.length).toBeGreaterThan(10);
  });

  it("contains at least 200 unique phrases in RUSSIAN_FILLERS and RUSSIAN_INTERVIEW_FILLERS", () => {
    expect(RUSSIAN_FILLERS.length).toBeGreaterThanOrEqual(200);
    expect(RUSSIAN_INTERVIEW_FILLERS.length).toBeGreaterThanOrEqual(200);
    const uniqueSet = new Set(RUSSIAN_FILLERS);
    expect(uniqueSet.size).toBeGreaterThanOrEqual(200);
    expect(uniqueSet.size).toBe(RUSSIAN_FILLERS.length);
  });

  it("selects a filler in the language of the question", () => {
    // The script of the question decides the phrase: a Russian opener under an
    // English question (or the reverse) reads as a script being read aloud.
    for (let i = 0; i < 8; i++) {
      expect(RUSSIAN_INTERVIEW_FILLERS).toContain(
        selectFillerForText("Расскажи про свой опыт с Postgres и Kubernetes")
      );
      expect(ENGLISH_FILLERS).toContain(
        selectFillerForText("Tell me about your experience with distributed systems")
      );
    }
  });

  it("detects the language of a question by its script", () => {
    expect(detectTextLanguage("Как вы оптимизируете запросы")).toBe("ru");
    expect(detectTextLanguage("How do you optimise queries")).toBe("en");
    expect(detectTextLanguage("")).toBe("en");
    // A heavily mixed question follows the script that dominates it.
    expect(detectTextLanguage("Расскажи, как ты работал с the event loop и его фазами")).toBe("ru");
  });

  it("never repeats a filler within the last ten picks, per language", () => {
    const picks: string[] = [];
    for (let i = 0; i < 40; i++) {
      const phrase = selectFillerForText("What is your experience with Kubernetes");
      expect(picks.slice(-10)).not.toContain(phrase);
      picks.push(phrase);
    }
  });

  it("guarantees selection without repeats over 50 consecutive iterations", () => {
    const selected: string[] = [];
    for (let i = 0; i < 50; i++) {
      const phrase = selectRussianFiller();
      // Check that it does not match the immediately preceding recent history (LRU window of 10)
      const recentWindow = selected.slice(-10);
      expect(recentWindow).not.toContain(phrase);
      selected.push(phrase);
    }
    expect(selected.length).toBe(50);
  });
  it("evaluates eligibility for manual Ask AI", () => {
    expect(isExplicitAskEligible("")).toBe(false);
    expect(isExplicitAskEligible("  ")).toBe(false);
    expect(isExplicitAskEligible("hi")).toBe(false);
    expect(isExplicitAskEligible("yes")).toBe(true);
    expect(isExplicitAskEligible("Explain React hooks")).toBe(true);
    expect(isExplicitAskEligible("Как работает event loop?")).toBe(true);
  });

  it("selects deterministic Russian interview filler based on seed", () => {
    const fillerA = selectRussianFiller("utterance-123");
    const fillerB = selectRussianFiller("utterance-123");
    expect(fillerA).toBe(fillerB);
    expect(RUSSIAN_INTERVIEW_FILLERS).toContain(fillerA);
  });

  it("finalizes nonexistent activeId gracefully without crashing", () => {
    let list: TranscriptUtterance[] = [];
    const res = upsertUtterance(list, {
      source: "them",
      text: "Testing",
      partial: true,
    });
    const finalized = finalizeUtterance(res.list, "non-existent-id");
    expect(finalized).toEqual(res.list);
  });
  it("resets English recent filler indices allowing the same filler after reset", () => {
    const randomSpy = vi.spyOn(Math, "random");
    try {
      // Return index 0 (0 / ENGLISH_FILLERS.length)
      randomSpy.mockReturnValue(0);
      const first = selectFillerForText("Hello world");
      expect(first).toBe(ENGLISH_FILLERS[0]);

      // Sequence: if recent is NOT reset, 0 is rejected and next random (index 1) is chosen.
      // If recent IS reset, 0 is accepted immediately on first roll.
      randomSpy.mockReturnValueOnce(0).mockReturnValueOnce(1 / ENGLISH_FILLERS.length);
      resetRecentFillers();
      const second = selectFillerForText("Hello world");
      expect(second).toBe(ENGLISH_FILLERS[0]);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
