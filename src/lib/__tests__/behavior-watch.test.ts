import { describe, it, expect, beforeEach } from "vitest";
import {
  observeShorten,
  observeLengthSwitch,
  observeElaborate,
  dismissSuggestion,
  getActiveSuggestions,
  confirmSuggestion,
  resetBehaviorWatch,
} from "../behavior-watch";
import { getSmartRules } from "../storage/smart-rules";

describe("F3 T3 (R07): Behavior Watch", () => {
  beforeEach(() => {
    localStorage.clear();
    resetBehaviorWatch();
  });

  describe("Scenario: Три укорачивания предлагают правило", () => {
    it("returns null on 1st and 2nd shortening, fires suggestion on 3rd", () => {
      expect(observeShorten()).toBeNull();
      expect(observeShorten()).toBeNull();

      const suggestion = observeShorten();
      expect(suggestion).not.toBeNull();
      expect(suggestion?.id).toBeDefined();
      expect(suggestion?.ruleText).toMatch(/короче|кратк/i);
      expect(suggestion?.reason).toMatch(/3.*укорач/i);
      expect(suggestion?.at).toBeGreaterThan(0);
    });

    it("does NOT persist any smart rule automatically without confirmation", () => {
      // 3 shortenings
      observeShorten();
      observeShorten();
      const suggestion = observeShorten();
      expect(suggestion).not.toBeNull();

      // Verify smart-rules storage has NOT been modified
      const rules = getSmartRules();
      expect(rules).toHaveLength(0);
    });

    it("clears suggestion when dismissSuggestion is called", () => {
      observeShorten();
      observeShorten();
      const suggestion = observeShorten();
      expect(suggestion).not.toBeNull();
      expect(getActiveSuggestions()).toHaveLength(1);

      dismissSuggestion(suggestion!.id);
      expect(getActiveSuggestions()).toHaveLength(0);

      // Verify still nothing persisted
      expect(getSmartRules()).toHaveLength(0);
    });

    it("persists rule only upon explicit confirmSuggestion call", () => {
      observeShorten();
      observeShorten();
      const suggestion = observeShorten();
      expect(suggestion).not.toBeNull();

      const createdRule = confirmSuggestion(suggestion!.id);
      expect(createdRule).not.toBeNull();
      expect(createdRule?.text).toBe(suggestion?.ruleText);

      // Now it is in smart rules
      const rules = getSmartRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].text).toBe(suggestion?.ruleText);
      expect(rules[0].origin.source).toBe("feedback");

      // And suggestion is cleared from active list
      expect(getActiveSuggestions()).toHaveLength(0);
    });
  });

  describe("Additional patterns: repeated length-switch & elaborate", () => {
    it("fires suggestion on 3 consecutive length switches to concise", () => {
      expect(observeLengthSwitch("concise")).toBeNull();
      expect(observeLengthSwitch("concise")).toBeNull();

      const suggestion = observeLengthSwitch("concise");
      expect(suggestion).not.toBeNull();
      expect(suggestion?.ruleText).toMatch(/короче|кратк/i);
      expect(getSmartRules()).toHaveLength(0);
    });

    it("fires suggestion on 3 consecutive length switches to detailed", () => {
      expect(observeLengthSwitch("detailed")).toBeNull();
      expect(observeLengthSwitch("detailed")).toBeNull();

      const suggestion = observeLengthSwitch("detailed");
      expect(suggestion).not.toBeNull();
      expect(suggestion?.ruleText).toMatch(/подробн/i);
      expect(getSmartRules()).toHaveLength(0);
    });

    it("resets counter if length switch target alternates", () => {
      expect(observeLengthSwitch("concise")).toBeNull();
      expect(observeLengthSwitch("detailed")).toBeNull();
      expect(observeLengthSwitch("concise")).toBeNull();
      // Only 1 concise in a row now, not 3
      expect(observeLengthSwitch("concise")).toBeNull();
      const suggestion = observeLengthSwitch("concise");
      expect(suggestion).not.toBeNull();
    });

    it("fires suggestion on 3 elaborate requests", () => {
      expect(observeElaborate()).toBeNull();
      expect(observeElaborate()).toBeNull();

      const suggestion = observeElaborate();
      expect(suggestion).not.toBeNull();
      expect(suggestion?.ruleText).toMatch(/подробн/i);
      expect(getSmartRules()).toHaveLength(0);
    });
  });
});
