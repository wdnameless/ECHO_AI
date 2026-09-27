import { describe, it, expect } from "vitest";
import { detectLanguage } from "../language-detect";

/**
 * The translation direction is derived from the text itself, because the two
 * sides of a conversation speak different languages: a Russian interviewer must
 * read English answers and vice versa. Every row on screen therefore needs its
 * own direction, and the rule is "translate into the OTHER language", never
 * "translate into the language the answer happens to use".
 *
 * This is the first half of that rule — what the target language becomes. The
 * second half (that a provider failure must not return the input unchanged) is
 * guarded in `fast-translator`, where a MyMemory quota warning would otherwise
 * have been rendered as the translation.
 */
describe("translation direction", () => {
  const targetFor = (text: string) => (detectLanguage(text) === "russian" ? "en" : "ru");

  it("sends Russian to English", () => {
    // The AI answer from the meeting screen, which came back untranslated.
    expect(
      targetFor(
        "Слушайте, тут такая история... я же чисто цифровая сущность, дверей у меня нет."
      )
    ).toBe("en");
    expect(targetFor("Откройте дверь. Господи, Коже.")).toBe("en");
  });

  it("sends English to Russian", () => {
    expect(targetFor("Open the door. Oh my God, open the door.")).toBe("ru");
    expect(targetFor("Yeah, probably for the best.")).toBe("ru");
  });

  it("reads a mixed utterance as the language that dominates it", () => {
    // Interviewer speech on this machine came out as mostly Russian with English
    // interjections; it must still be translated into English, not left as is.
    expect(
      targetFor("Mmm hmm. Is that Откройте! О, Господи! Откройте дверь. Yeah. Thank you.")
    ).toBe("en");
  });

  it("treats a number-only string as English rather than throwing", () => {
    // No letters at all: detectLanguage returns null, and the target must still
    // be a valid language so the request is well-formed.
    expect(targetFor("123 456")).toBe("ru");
  });
});
