import { describe, it, expect } from "vitest";
import {
  computeWer,
  detectLanguage,
  evaluateCase,
  runBenchmark,
} from "./bench.mjs";

describe("bench metrics", () => {
  describe("computeWer", () => {
    it("returns 0 for identical texts", () => {
      const wer = computeWer("hello world", "hello world");
      expect(wer).toBe(0);
    });

    it("returns 1 for completely different texts of same length", () => {
      const wer = computeWer("hello world", "foo bar");
      expect(wer).toBe(1);
    });

    it("handles insertions and deletions correctly", () => {
      const wer = computeWer("the quick brown fox", "the brown fox");
      expect(wer).toBeCloseTo(0.25, 2);
    });

    it("handles empty strings", () => {
      expect(computeWer("", "")).toBe(0);
      expect(computeWer("hello", "")).toBe(1);
      expect(computeWer("", "world")).toBe(1);
    });
  });

  describe("detectLanguage", () => {
    it("detects English correctly", () => {
      expect(detectLanguage("How do you implement quicksort in Rust?")).toBe("en");
    });

    it("detects Russian correctly", () => {
      expect(detectLanguage("Как реализовать быструю сортировку на Rust?")).toBe("ru");
    });
  });

  describe("evaluateCase", () => {
    it("evaluates a case and returns metrics", () => {
      const testCase = {
        id: "case-01",
        transcript: "Explain dependency injection in TypeScript",
        expected: {
          language: "en",
          reference: "Dependency injection is a design pattern where dependencies are provided to a class",
          keywords: ["dependency", "injection", "pattern"],
        },
      };

      const result = evaluateCase(testCase);
      expect(result.id).toBe("case-01");
      expect(result.langMatch).toBe(true);
      expect(typeof result.wer).toBe("number");
      expect(typeof result.ttftMs).toBe("number");
      expect(result.ttftMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("runBenchmark", () => {
    it("runs corpus with 20+ cases and produces summary report", () => {
      const corpus = Array.from({ length: 22 }, (_, i) => ({
        id: `case-${i + 1}`,
        transcript: i % 2 === 0 ? `Question number ${i} about architecture` : `Вопрос номер ${i} об архитектуре`,
        expected: {
          language: i % 2 === 0 ? "en" : "ru",
          reference: i % 2 === 0 ? `Answer for architecture question ${i}` : `Ответ на вопрос по архитектуре ${i}`,
          keywords: ["architecture"],
        },
      }));

      const report = runBenchmark(corpus);
      expect(report.totalCases).toBe(22);
      expect(report.results.length).toBe(22);
      expect(report.avgWer).toBeGreaterThanOrEqual(0);
      expect(report.avgTtftMs).toBeGreaterThanOrEqual(0);
      expect(report.langAccuracy).toBe(100);
    });
  });
});
