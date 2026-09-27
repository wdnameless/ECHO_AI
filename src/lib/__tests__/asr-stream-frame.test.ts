import { describe, it, expect, vi } from "vitest";
import { handleAsrStreamFrame } from "../asr-stream-frame";

/**
 * Both channels (mic, system audio) dispatch their frames through this one
 * function, so it is the boundary where recogniser boilerplate must die.
 *
 * Live report: the feed showed «Okay. Whoa. Hey, what? Субтитры сделал
 * DimaTorzok Тогда бы тут ты не появился.» as the interviewer's own line and the
 * AI answered the credits.
 */
const handlers = () => ({
  onPartialTranscript: vi.fn(),
  onFinalTranscript: vi.fn(),
});

const frame = (type: string, text: string) => JSON.stringify({ type, text });

describe("handleAsrStreamFrame boilerplate scrub", () => {
  it("drops a credit-only frame from both kinds", () => {
    for (const type of ["text", "final"]) {
      const h = handlers();
      handleAsrStreamFrame(frame(type, "Субтитры сделал DimaTorzok"), h);
      expect(h.onPartialTranscript).not.toHaveBeenCalled();
      expect(h.onFinalTranscript).not.toHaveBeenCalled();
    }
  });

  it("keeps the speech a credit was spliced into", () => {
    const h = handlers();
    handleAsrStreamFrame(
      frame("final", "Okay. Whoa. Hey, what? Субтитры сделал DimaTorzok Тогда бы тут ты не появился."),
      h
    );
    expect(h.onFinalTranscript).toHaveBeenCalledWith(
      "Okay. Whoa. Hey, what? Тогда бы тут ты не появился."
    );
  });

  it("scrubs partials too, so the credit never flashes on screen", () => {
    const h = handlers();
    handleAsrStreamFrame(frame("text", "Эй, держи. Субтитры сделал DimaTorzok"), h);
    expect(h.onPartialTranscript).toHaveBeenCalledWith("Эй, держи.");
  });

  it("passes ordinary speech through untouched", () => {
    const h = handlers();
    handleAsrStreamFrame(frame("text", "Расскажите про ваш опыт с React"), h);
    expect(h.onPartialTranscript).toHaveBeenCalledWith(
      "Расскажите про ваш опыт с React"
    );
  });

  it("still ignores malformed, empty and status frames", () => {
    const h = handlers();
    handleAsrStreamFrame("not json", h);
    handleAsrStreamFrame(frame("status", ""), h);
    handleAsrStreamFrame("", h);
    handleAsrStreamFrame(null, h);
    expect(h.onPartialTranscript).not.toHaveBeenCalled();
    expect(h.onFinalTranscript).not.toHaveBeenCalled();
  });
});
