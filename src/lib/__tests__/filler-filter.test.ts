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
    const input = "Um, I think, like, we should, you know, refactor this, uh, service.";
    const result = service.filter(input);
    expect(result).toBe("I think, we should, refactor this, service.");
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
});
