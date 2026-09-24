import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MODEL_CAPABILITY_LANGUAGES,
  recognitionLanguage,
  getAvailableCapabilityLanguages,
} from "@/lib/constants/languages";

/**
 * A language in the picker that no model speaks is a filter that can only return
 * an empty list. The user reads that as "the filter is broken" rather than "no
 * model supports Irish", so the picker should offer what the catalogue actually
 * has.
 */
describe("model language picker relevance", () => {
  const catalog = JSON.parse(
    readFileSync("src-tauri/src/model_catalog.json", "utf-8")
  ) as { models: Array<{ languages: string[] }> };

  it("offers only languages that at least one catalogue model speaks", () => {
    const offered = getAvailableCapabilityLanguages(catalog.models);
    // The full picker list carried 38 entries no model could satisfy.
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThan(MODEL_CAPABILITY_LANGUAGES.length);

    const available = new Set<string>();
    for (const m of catalog.models) {
      for (const code of m.languages) available.add(recognitionLanguage(code));
    }
    for (const language of offered) {
      expect(available.has(recognitionLanguage(language.value))).toBe(true);
    }
  });

  it("keeps languages that only appear as a regional variant", () => {
    // The streaming model declares en-US/ru-RU style codes; their base codes
    // must still produce picker entries.
    const offered = getAvailableCapabilityLanguages([
      { languages: ["en-US", "ru-RU", "de-DE"] },
    ]);
    const values = offered.map((l) => l.value);
    expect(values).toEqual(expect.arrayContaining(["en", "ru", "de"]));
  });
});
