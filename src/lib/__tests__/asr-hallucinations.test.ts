import { describe, it, expect } from "vitest";
import {
  scrubAsrHallucinations,
  isAsrHallucination,
} from "../asr-hallucinations";
import { isHtmlResponse, isAbsoluteHttpUrl } from "../functions/stt.function";

/**
 * All three guards exist for the same reason: text the recogniser never heard
 * was shown as the interviewer's speech and answered by the AI.
 *
 * The Russian strings are copied from the live feed, not invented.
 */
describe("ASR boilerplate scrub", () => {
  it("removes the credits the live feed showed as speech", () => {
    expect(scrubAsrHallucinations("Субтитры сделал DimaTorzok")).toBe("");
    expect(
      scrubAsrHallucinations("Продолжение следует. Субтитры сделал DimaTorzok")
    ).toBe("");
    expect(scrubAsrHallucinations("Редактор субтитров А.Синецкая")).toBe("");
  });

  it("keeps the speech the credits were spliced into", () => {
    // Exactly what the screen showed: real words either side of a credit.
    expect(
      scrubAsrHallucinations(
        "Okay. Whoa. Hey, what? Субтитры сделал DimaTorzok Тогда бы тут ты не появился."
      )
    ).toBe("Okay. Whoa. Hey, what? Тогда бы тут ты не появился.");

    expect(
      scrubAsrHallucinations("Эй, держи, осторожно, лови, лови его. Субтитры сделал DimaTorzok")
    ).toBe("Эй, держи, осторожно, лови, лови его.");
  });

  it("removes the credits whatever the casing and spacing", () => {
    expect(scrubAsrHallucinations("  субтитры   СДЕЛАЛ dimaTorzok  ")).toBe("");
  });

  it("removes the English equivalents", () => {
    expect(scrubAsrHallucinations("Thanks for watching!")).toBe("");
    expect(scrubAsrHallucinations("Subtitles by the Amara.org community")).toBe("");
  });

  it("treats a bare 'продолжение следует' as boilerplate", () => {
    expect(isAsrHallucination("Продолжение следует...")).toBe(true);
    expect(isAsrHallucination("To be continued")).toBe(true);
  });

  it("keeps a sentence that merely contains the phrase", () => {
    // Here the speaker really said it, so the line must survive.
    const said = "Я не знаю, что дальше, но продолжение следует из твоих слов";
    expect(scrubAsrHallucinations(said)).toBe(said);
  });

  it("keeps ordinary speech untouched", () => {
    for (const said of [
      "Пошли, бля!",
      "Расскажите про ваш опыт с React",
      "Yeah, come say.",
    ]) {
      expect(scrubAsrHallucinations(said)).toBe(said);
    }
  });

  it("treats nothing as nothing", () => {
    expect(scrubAsrHallucinations("")).toBe("");
    expect(scrubAsrHallucinations("   ")).toBe("");
    expect(scrubAsrHallucinations(null)).toBe("");
    expect(isAsrHallucination("")).toBe(false);
    expect(isAsrHallucination(null)).toBe(false);
    expect(isAsrHallucination(undefined)).toBe(false);
  });
});

describe("HTML response guard", () => {
  it("recognises the app's own page as not-a-transcription", () => {
    // A scheme-less request URL resolves against the WebView origin, so this is
    // what came back with HTTP 200 and was shown as speech.
    expect(
      isHtmlResponse(
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Tauri + React</title></head></html>'
      )
    ).toBe(true);
    expect(isHtmlResponse("  <html><body>hi</body></html>")).toBe(true);
  });

  it("does not mistake JSON or plain text for markup", () => {
    expect(isHtmlResponse('{"text": "привет"}')).toBe(false);
    expect(isHtmlResponse("просто текст")).toBe(false);
    expect(isHtmlResponse("")).toBe(false);
  });
});

describe("absolute URL guard", () => {
  it("rejects the scheme-less URL that reached the WebView origin", () => {
    expect(isAbsoluteHttpUrl("null/v1/asr/transcribe?language=ru")).toBe(false);
    expect(isAbsoluteHttpUrl("/v1/asr/transcribe")).toBe(false);
    expect(isAbsoluteHttpUrl("")).toBe(false);
  });

  it("accepts the local engine and the gateway", () => {
    expect(isAbsoluteHttpUrl("http://127.0.0.1:9877/v1/asr/transcribe")).toBe(true);
    expect(isAbsoluteHttpUrl("https://ai-gateway.nullform.cv/v1/chat")).toBe(true);
  });
});
