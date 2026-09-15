import { describe, it, expect } from "vitest";
import {
  FEATURE_TIER,
  canUseFeature,
  Feature,
} from "../entitlements";

describe("entitlements", () => {
  describe("feature classification (FEATURE_TIER)", () => {
    it("classifies local core features as Free (R15)", () => {
      expect(FEATURE_TIER.dictation).toBe("free");
      expect(FEATURE_TIER.meeting).toBe("free");
      expect(FEATURE_TIER.localStt).toBe("free");
      expect(FEATURE_TIER.byoKey).toBe("free");
      expect(FEATURE_TIER.chatHistory).toBe("free");
      expect(FEATURE_TIER.customPrompts).toBe("free");
    });

    it("classifies premium & cloud features as Pro (R16)", () => {
      expect(FEATURE_TIER.hostedApi).toBe("pro");
      expect(FEATURE_TIER.screenshot).toBe("pro");
      expect(FEATURE_TIER.selectionMode).toBe("pro");
      expect(FEATURE_TIER.themes).toBe("pro");
      expect(FEATURE_TIER.fonts).toBe("pro");
      expect(FEATURE_TIER.customShortcuts).toBe("pro");
      expect(FEATURE_TIER.promptGeneration).toBe("pro");
      expect(FEATURE_TIER.analytics).toBe("pro");
      expect(FEATURE_TIER.responseLength).toBe("pro");
      expect(FEATURE_TIER.language).toBe("pro");
      expect(FEATURE_TIER.autoScroll).toBe("pro");
    });
  });

  describe("canUseFeature in dev mode", () => {
    it("allows all features (both free and pro) in dev mode", () => {
      const allFeatures = Object.keys(FEATURE_TIER) as Feature[];
      allFeatures.forEach((feature) => {
        expect(canUseFeature(feature, { isDevBuild: true, hasLicense: false })).toBe(true);
        expect(canUseFeature(feature, true, false)).toBe(true);
      });
    });
  });

  describe("canUseFeature in release mode", () => {
    it("allows free features even without license in release mode", () => {
      const freeFeatures: Feature[] = [
        "dictation",
        "meeting",
        "localStt",
        "byoKey",
        "chatHistory",
        "customPrompts",
      ];
      freeFeatures.forEach((feature) => {
        expect(canUseFeature(feature, { isDevBuild: false, hasLicense: false })).toBe(true);
        expect(canUseFeature(feature, false, false)).toBe(true);
      });
    });

    it("blocks pro features without active license in release mode", () => {
      const proFeatures: Feature[] = [
        "hostedApi",
        "screenshot",
        "selectionMode",
        "themes",
        "fonts",
        "customShortcuts",
        "promptGeneration",
        "analytics",
        "responseLength",
        "language",
        "autoScroll",
      ];
      proFeatures.forEach((feature) => {
        expect(canUseFeature(feature, { isDevBuild: false, hasLicense: false })).toBe(false);
        expect(canUseFeature(feature, false, false)).toBe(false);
      });
    });

    it("allows pro features with active license in release mode", () => {
      const proFeatures: Feature[] = [
        "hostedApi",
        "screenshot",
        "selectionMode",
        "themes",
        "fonts",
        "customShortcuts",
        "promptGeneration",
        "analytics",
        "responseLength",
        "language",
        "autoScroll",
      ];
      proFeatures.forEach((feature) => {
        expect(canUseFeature(feature, { isDevBuild: false, hasLicense: true })).toBe(true);
        expect(canUseFeature(feature, false, true)).toBe(true);
      });
    });
  });
});
