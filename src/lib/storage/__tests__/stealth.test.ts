import { describe, it, expect, beforeEach } from "vitest";
import {
  getCustomizableState,
  updateStealthMode,
  DEFAULT_CUSTOMIZABLE_STATE,
} from "../customizable.storage";
import { STORAGE_KEYS } from "@/config";

describe("stealth storage state (R09-R11)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to stealth disabled", () => {
    const state = getCustomizableState();
    expect(state.stealth.isEnabled).toBe(false);
    expect(DEFAULT_CUSTOMIZABLE_STATE.stealth.isEnabled).toBe(false);
  });

  it("updates stealth mode to enabled and persists to storage", () => {
    const updated = updateStealthMode(true);
    expect(updated.stealth.isEnabled).toBe(true);

    const reloaded = getCustomizableState();
    expect(reloaded.stealth.isEnabled).toBe(true);
  });

  it("updates stealth mode to disabled and persists to storage", () => {
    updateStealthMode(true);
    const turnedOff = updateStealthMode(false);
    expect(turnedOff.stealth.isEnabled).toBe(false);

    const reloaded = getCustomizableState();
    expect(reloaded.stealth.isEnabled).toBe(false);
  });

  it("handles corrupt storage by falling back to default", () => {
    localStorage.setItem(STORAGE_KEYS.CUSTOMIZABLE, "not-json");
    const state = getCustomizableState();
    expect(state.stealth.isEnabled).toBe(false);
  });
});
