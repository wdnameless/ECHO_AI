import { describe, it, expect, beforeEach } from "vitest";
import { applyCorrections, setCachedCorrections, AsrCorrection } from "../vocab";

describe("applyCorrections", () => {
  beforeEach(() => {
    const corrections: AsrCorrection[] = [
      { id: 1, wrong: "киберспорт", right: "киберспорт" },
      { id: 2, wrong: "блюли", right: "Pluely" },
      { id: 3, wrong: "плюли", right: "Pluely" },
      { id: 4, wrong: "asr", right: "ASR" },
      { id: 5, wrong: "ошибка", right: "исправление" },
    ];
    setCachedCorrections(corrections);
  });

  it("replaces exact word match case-insensitively", () => {
    expect(applyCorrections("Это блюли")).toBe("Это Pluely");
    expect(applyCorrections("Это БЛЮЛИ!")).toBe("Это Pluely!");
    expect(applyCorrections("Это Плюли")).toBe("Это Pluely");
    expect(applyCorrections("testing asr model")).toBe("testing ASR model");
    expect(applyCorrections("testing ASR model")).toBe("testing ASR model");
  });

  it("correctly handles Cyrillic word boundaries and does not replace subwords", () => {
    // "ошибка" should be replaced, but not inside "ошибками" or "неошибка"
    expect(applyCorrections("Тут есть ошибка в коде")).toBe("Тут есть исправление в коде");
    expect(applyCorrections("Тут есть ошибками в коде")).toBe("Тут есть ошибками в коде");
    expect(applyCorrections("Тут есть неошибка в коде")).toBe("Тут есть неошибка в коде");
  });

  it("handles mixed case and punctuation edges", () => {
    expect(applyCorrections("киберспорт.")).toBe("киберспорт.");
    expect(applyCorrections("КИБЕРСПОРТ,")).toBe("киберспорт,");
    expect(applyCorrections("(киберспорт)")).toBe("(киберспорт)");
    expect(applyCorrections("«блюли»")).toBe("«Pluely»");
    expect(applyCorrections("...плюли... asr?")).toBe("...Pluely... ASR?");
    expect(applyCorrections(" блюли ")).toBe(" Pluely ");
  });

  it("handles identity correction without change", () => {
    expect(applyCorrections("киберспорт")).toBe("киберспорт");
  });

  it("preserves empty or untracked text", () => {
    expect(applyCorrections("")).toBe("");
    expect(applyCorrections("Привет мир")).toBe("Привет мир");
  });
});
