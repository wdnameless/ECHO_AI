import { describe, it, expect } from "vitest";
import {
  upsertUtterance,
  finalizeUtterance,
  selectRussianFiller,
  isExplicitAskEligible,
  RUSSIAN_INTERVIEW_FILLERS,
  TranscriptUtterance,
} from "../transcript-stabilizer";

describe("transcript-stabilizer", () => {
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
});
