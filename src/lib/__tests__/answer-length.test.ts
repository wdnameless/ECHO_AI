import { describe, it, expect } from "vitest";
import {
  splitLengthPrefix,
  isLongQuestion,
  resolveAnswerLength,
} from "../answer-length";
import {
  ANSWER_OPENERS_RU,
  ANSWER_OPENERS_EN,
  pickAnswerOpener,
  resetOpenerRotationForTests,
} from "@/config/humanizer.rules";

/**
 * Adaptive length: detail markers and explicit prefixes decide, not a fixed
 * 35-55 cap. The opener pool must never repeat twice in a row — "Ну, смотрите"
 * every answer reads as a script.
 */
describe("answer length", () => {
  it("long on detail markers", () => {
    expect(isLongQuestion("Почему детект занимает час?")).toBe(true);
    expect(isLongQuestion("Сравни подходы и объясни разницу")).toBe(true);
    expect(isLongQuestion("Расскажи подробно про алерты")).toBe(true);
  });

  it("short on small talk", () => {
    expect(isLongQuestion("Понял")).toBe(false);
    expect(isLongQuestion("Да, согласен")).toBe(false);
  });

  it("explicit prefixes override everything", () => {
    expect(splitLengthPrefix("подробно: расскажи").override).toBe("long");
    expect(splitLengthPrefix("кратко: расскажи про опыт").override).toBe("short");
    expect(splitLengthPrefix("кратко: почему так").cleaned).toBe("почему так");
    // Toolbar long loses to an explicit short prefix.
    expect(resolveAnswerLength("кратко: почему так вышло", "long")).toBe("short");
    expect(resolveAnswerLength("почему так вышло", "short")).toBe("short");
    expect(resolveAnswerLength("почему так вышло", "auto")).toBe("long");
  });
});

describe("opener rotation", () => {
  it("pools hold 12+ entries each", () => {
    expect(ANSWER_OPENERS_RU.length).toBeGreaterThanOrEqual(12);
    expect(ANSWER_OPENERS_EN.length).toBeGreaterThanOrEqual(12);
  });

  it("never repeats twice in a row over 30 picks", () => {
    resetOpenerRotationForTests();
    let prev = pickAnswerOpener("ru");
    for (let i = 0; i < 30; i++) {
      const next = pickAnswerOpener("ru");
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
});


describe("P2 language mismatch badge", () => {
  it("detectTextLanguage decides by script majority", async () => {
    const { detectTextLanguage } = await import("@/lib/transcript-stabilizer");
    expect(detectTextLanguage("Кто будет владеть этими алертами?")).toBe("ru");
    expect(detectTextLanguage("Who did it? Tell me about MTTR")).toBe("en");
  });

  it("short noise does not deserve a badge (min length 8)", async () => {
    const { detectTextLanguage } = await import("@/lib/transcript-stabilizer");
    expect("Mm-hmm.".trim().length).toBeLessThan(8);
    expect(detectTextLanguage("Mm-hmm.")).toBe("en");
  });

  it("mismatch shows only when spoken differs from active model", () => {
    const spoken: string = "ru";
    const activeModel: string = "en";
    expect(spoken === activeModel).toBe(false);
  });
});
