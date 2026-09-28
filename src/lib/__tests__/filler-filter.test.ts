import { describe, it, expect, beforeEach } from "vitest";
import {
  FillerFilterService,
  filterFillers,
  normalizePunctuationAndWhitespace,
  getFillerFilterConfig,
  saveFillerFilterConfig,
  FILLER_FILTER_STORAGE_KEYS,
} from "../filler-filter";
import { safeLocalStorage } from "../storage/helper";

describe("FillerFilterService & filler removal", () => {
  beforeEach(() => {
    safeLocalStorage.removeItem(FILLER_FILTER_STORAGE_KEYS.FILTER_AI_ENABLED);
    safeLocalStorage.removeItem(FILLER_FILTER_STORAGE_KEYS.FILTER_FEED_ENABLED);
    safeLocalStorage.removeItem(FILLER_FILTER_STORAGE_KEYS.CUSTOM_FILLERS);
  });
  it("removes Russian filler words correctly", () => {
    const service = new FillerFilterService();
    const input = "Ээ, привет, ну как бы расскажи про свой опыт, типа вот.";
    const result = service.filter(input);
    expect(result).toBe("привет, расскажи про свой опыт.");
  });

  it("removes English filler words correctly", () => {
    const service = new FillerFilterService();
    // No "like" in defaults: the verb survives ("I like it"), so a filler
    // "like" survives here too — the price of not destroying meaning.
    const input = "Um, I think, you know, we should refactor this, uh, service.";
    const result = service.filter(input);
    expect(result).toBe("I think, we should refactor this, service.");
  });

  it("does not corrupt legitimate vocabulary containing substrings (test 1.3)", () => {
    const service = new FillerFilterService();
    // "эмблема" has "эм", "королева" has "коро", "нумизмат" has "ну", "типаж" has "типа", "likeable" has "like"
    const input = "Эмблема компании была создана нумизматом, и типаж королевы выглядел naturally likeable.";
    const result = service.filter(input);
    expect(result).toBe("Эмблема компании была создана нумизматом, и типаж королевы выглядел naturally likeable.");
  });

  it("handles multi-word fillers properly without leaving broken grammar", () => {
    const service = new FillerFilterService();
    const input = "Как бы я хотел сказать, you know, что всё готово.";
    const result = service.filter(input);
    expect(result).toBe("я хотел сказать, что всё готово.");
  });

  it("normalizes double punctuation, spaces, and leading/trailing punctuation", () => {
    expect(normalizePunctuationAndWhitespace("  Привет ,  ,   мир  ! ")).toBe("Привет, мир!");
    expect(normalizePunctuationAndWhitespace(", , Привет мир , ")).toBe("Привет мир");
    expect(normalizePunctuationAndWhitespace("")).toBe("");
  });

  it("supports custom comma-separated filler vocabulary", () => {
    const custom = "кстати, короче говоря, basically";
    const service = new FillerFilterService(custom);
    const input = "Кстати, это, короче говоря, basically очень важно.";
    const result = service.filter(input);
    expect(result).toBe("это, очень важно.");
  });

  it("handles empty custom filler dictionary gracefully", () => {
    const service = new FillerFilterService("");
    const input = "Эм, вот так.";
    expect(service.filter(input)).toBe("так.");
  });

  it("persists and reads configuration via safeLocalStorage", () => {
    const initial = getFillerFilterConfig();
    expect(initial.filterAiEnabled).toBe(true);
    expect(initial.filterFeedEnabled).toBe(false);
    expect(initial.customFillers).toBe("");

    saveFillerFilterConfig({
      filterAiEnabled: false,
      filterFeedEnabled: true,
      customFillers: "в общем, purely",
    });

    const updated = getFillerFilterConfig();
    expect(updated.filterAiEnabled).toBe(false);
    expect(updated.filterFeedEnabled).toBe(true);
    expect(updated.customFillers).toBe("в общем, purely");
  });

  it("convenience function filterFillers works as expected", () => {
    const result = filterFillers("Ээ, тест, um, works.", "тест");
    expect(result).toBe("works.");
  });

  it("keeps hyphenated words whole: 'ну-ка' is not trimmed to '-ка'", () => {
    const service = new FillerFilterService();
    expect(service.filter("ну-ка расскажи")).toBe("ну-ка расскажи");
    expect(service.filter("Скажи ну-ка")).toBe("Скажи ну-ка");
    expect(service.filter("Send this letter now")).toBe("Send this letter now");
    // Elongated fillers ARE removed.
    expect(service.filter("ну-у, погоди")).toBe("погоди");
    expect(service.filter("ну-у-у, я не знаю")).toBe("я не знаю");
  });

  it("keeps the discourse particle: 'ну же' survives, bare 'ну' does not", () => {
    const service = new FillerFilterService("ну");
    expect(service.filter("ну-ка, покажи")).toBe("ну-ка, покажи");
    expect(service.filter("ну же, пойдём")).toBe("ну же, пойдём");
    expect(service.filter("Привет, ну, расскажи")).toBe("Привет, расскажи");
    expect(service.filter("ну, да")).toBe("да");
  });

  it("does not mistake the verb for the filler: 'I like it' survives", () => {
    const service = new FillerFilterService();
    expect(service.filter("I like it a lot")).toBe("I like it a lot");
  });

  it("deduplicates stray commas left by removed fillers", () => {
    expect(normalizePunctuationAndWhitespace("Привет, , расскажи")).toBe("Привет, расскажи");
    expect(normalizePunctuationAndWhitespace("Привет,, расскажи")).toBe("Привет, расскажи");
    expect(normalizePunctuationAndWhitespace("Привет,   ,   расскажи")).toBe("Привет, расскажи");
    const service = new FillerFilterService();
    // Bare "ну" IS a filler and is removed; only "ну-ка"/"ну же" survive.
    expect(service.filter("Ну, типа, я пошёл")).toBe("я пошёл");
  });
});
