import { describe, it, expect, beforeEach } from "vitest";
import {
  BUILTIN_PROFILES,
  getPromptProfiles,
  applyProfileToStorage,
  SALES_PROFILE_ID,
  RECRUITING_PROFILE_ID,
  LECTURE_PROFILE_ID,
  CALL_CENTER_PROFILE_ID,
} from "../prompt-profiles";
import { STORAGE_KEYS } from "@/config/constants";
import { safeLocalStorage } from "../helper";

describe("T4.1 Built-in Personas (R12: Sales, Recruiting, Lecture, Call Center)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("exports constants for the 4 new built-in persona IDs", () => {
    expect(SALES_PROFILE_ID).toBe("profile-sales");
    expect(RECRUITING_PROFILE_ID).toBe("profile-recruiting");
    expect(LECTURE_PROFILE_ID).toBe("profile-lecture");
    expect(CALL_CENTER_PROFILE_ID).toBe("profile-call-center");
  });

  it("includes Sales, Recruiting, Lecture, and Call Center in BUILTIN_PROFILES and getPromptProfiles()", () => {
    expect(BUILTIN_PROFILES.map((p) => p.id)).toContain(SALES_PROFILE_ID);
    const profiles = getPromptProfiles();
    const names = profiles.map((p) => p.name);
    const ids = profiles.map((p) => p.id);
    expect(ids).toContain(RECRUITING_PROFILE_ID);
    expect(ids).toContain(LECTURE_PROFILE_ID);
    expect(ids).toContain(CALL_CENTER_PROFILE_ID);

    expect(names).toContain("Sales");
    expect(names).toContain("Recruiting");
    expect(names).toContain("Lecture");
    expect(names).toContain("Call Center");
  });

  it("configures each persona with a distinct systemPrompt and flushGapMs", () => {
    const profiles = getPromptProfiles();

    const sales = profiles.find((p) => p.id === SALES_PROFILE_ID);
    expect(sales).toBeDefined();
    expect(sales?.systemPrompt).toBeTruthy();
    expect(typeof sales?.flushGapMs).toBe("number");
    expect(sales?.flushGapMs).toBeGreaterThan(0);

    const recruiting = profiles.find((p) => p.id === RECRUITING_PROFILE_ID);
    expect(recruiting).toBeDefined();
    expect(recruiting?.systemPrompt).toBeTruthy();
    expect(typeof recruiting?.flushGapMs).toBe("number");
    expect(recruiting?.flushGapMs).toBeGreaterThan(0);

    const lecture = profiles.find((p) => p.id === LECTURE_PROFILE_ID);
    expect(lecture).toBeDefined();
    expect(lecture?.systemPrompt).toBeTruthy();
    expect(typeof lecture?.flushGapMs).toBe("number");
    expect(lecture?.flushGapMs).toBeGreaterThan(0);

    const callCenter = profiles.find((p) => p.id === CALL_CENTER_PROFILE_ID);
    expect(callCenter).toBeDefined();
    expect(callCenter?.systemPrompt).toBeTruthy();
    expect(typeof callCenter?.flushGapMs).toBe("number");
    expect(callCenter?.flushGapMs).toBeGreaterThan(0);
  });

  it("applies selected persona systemPrompt to storage so responses use it (R12 scenario)", () => {
    const profiles = getPromptProfiles();
    const sales = profiles.find((p) => p.id === SALES_PROFILE_ID)!;

    applyProfileToStorage(sales);

    const storedPrompt = safeLocalStorage.getItem(STORAGE_KEYS.SYSTEM_PROMPT);
    expect(storedPrompt).toBe(sales.systemPrompt);
  });
});
