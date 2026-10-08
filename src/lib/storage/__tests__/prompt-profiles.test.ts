import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BUILTIN_PROFILES,
  INTERVIEW_PROFILE_ID,
  GENERAL_PROFILE_ID,
  CONVERSATION_PROFILE_ID,
  LIVECODE_PROFILE_ID,
  getPromptProfiles,
  getActiveProfileId,
  setActiveProfileId,
  getActiveProfile,
  applyProfileToStorage,
  savePromptProfiles,
  exportProfileToJson,
  exportProfilesToJson,
  importProfileFromJson,
  importProfilesFromJson,
  PromptProfile,
} from "../prompt-profiles";

describe("PromptProfiles (R01/R03: Scenario Profiles & Constructor Round-trip)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("Built-in Scenario Profiles (R01)", () => {
    it("provides the 3 required scenario profiles: Interview, Conversation, and Livecode", () => {
      const profiles = getPromptProfiles();
      const ids = profiles.map((p) => p.id);

      expect(ids).toContain(INTERVIEW_PROFILE_ID);
      expect(ids).toContain(GENERAL_PROFILE_ID);
      expect(ids).toContain(LIVECODE_PROFILE_ID);

      const interview = profiles.find((p) => p.id === INTERVIEW_PROFILE_ID);
      const conversation = profiles.find((p) => p.id === CONVERSATION_PROFILE_ID);
      const livecode = profiles.find((p) => p.id === LIVECODE_PROFILE_ID);

      expect(interview).toBeDefined();
      expect(conversation).toBeDefined();
      expect(livecode).toBeDefined();
    });

    it("Interview profile (R03): fast-path timings (450ms) and short default length", () => {
      const interview = getPromptProfiles().find((p) => p.id === INTERVIEW_PROFILE_ID);
      expect(interview?.flushGapMs).toBe(450);
      expect(interview?.defaultLength).toBe("short");
      expect(interview?.interviewMode).toBe(true);
      expect(interview?.visibleButtons).toContain("answer");
      expect(interview?.visibleButtons).toContain("length");
      expect(interview?.monologue?.mode).toBe("auto");
    });

    it("Conversation profile (R01/R02): conversational silence gap (1500ms) and monologue buffer", () => {
      const conversation = getPromptProfiles().find((p) => p.id === GENERAL_PROFILE_ID);
      expect(conversation?.flushGapMs).toBe(1500);
      expect(conversation?.defaultLength).toBe("auto");
      expect(conversation?.interviewMode).toBe(false);
      expect(conversation?.visibleButtons).toContain("monologue_send");
      expect(conversation?.monologue?.mode).toBe("auto");
      expect(conversation?.monologue?.maxWindow).toBeGreaterThanOrEqual(12000);
    });

    it("Livecode profile (R01): algorithmic prompt, code plan buttons, 500ms gap", () => {
      const livecode = getPromptProfiles().find((p) => p.id === LIVECODE_PROFILE_ID);
      expect(livecode?.flushGapMs).toBe(500);
      expect(livecode?.defaultLength).toBe("auto");
      expect(livecode?.visibleButtons).toContain("code_plan");
      expect(livecode?.visibleButtons).toContain("code_full");
      expect(livecode?.visibleButtons).toContain("livecode");
      expect(livecode?.systemPrompt).toContain("алгоритмам");
    });
  });

  describe("Profile Switching & Storage Application (R01)", () => {
    it("switches profile and updates active profile ID", () => {
      expect(getActiveProfileId()).toBe(INTERVIEW_PROFILE_ID);

      setActiveProfileId(LIVECODE_PROFILE_ID);
      expect(getActiveProfileId()).toBe(LIVECODE_PROFILE_ID);

      const active = getActiveProfile();
      expect(active.id).toBe(LIVECODE_PROFILE_ID);
    });

    it("applyProfileToStorage applies systemPrompt, responseLength and dispatches event", () => {
      const listener = vi.fn();
      window.addEventListener("prompt-profile-changed", listener);

      const livecode = getPromptProfiles().find((p) => p.id === LIVECODE_PROFILE_ID)!;
      applyProfileToStorage(livecode);

      expect(localStorage.getItem("system_prompt")).toBe(livecode.systemPrompt);
      expect(localStorage.getItem("active_profile_id")).toBe(LIVECODE_PROFILE_ID);
      expect(listener).toHaveBeenCalled();

      window.removeEventListener("prompt-profile-changed", listener);
    });
  });

  describe("Constructor CRUD & JSON Export/Import (R01: Round-trip)", () => {
    it("round-trips a single custom profile via exportProfileToJson and importProfileFromJson", () => {
      const custom: PromptProfile = {
        id: "profile-system-design-test",
        name: "System Design Round",
        description: "Specialized for distributed systems and high-load architecture",
        systemPrompt: "You are a distributed systems architect. Focus on scalability.",
        humanizerEnabled: false,
        interviewMode: true,
        customStyle: "concise, trade-offs first",
        ragResumeEnabled: true,
        ragJobEnabled: false,
        isBuiltin: false,
        flushGapMs: 800,
        defaultLength: "long",
        visibleButtons: ["length", "thought", "answer", "settings"],
        monologue: {
          mode: "semi",
          maxWindow: 20000,
        },
      };

      const json = exportProfileToJson(custom);
      expect(typeof json).toBe("string");

      const imported = importProfileFromJson(json);
      expect(imported).not.toBeNull();
      expect(imported?.name).toBe(custom.name);
      expect(imported?.description).toBe(custom.description);
      expect(imported?.systemPrompt).toBe(custom.systemPrompt);
      expect(imported?.flushGapMs).toBe(800);
      expect(imported?.defaultLength).toBe("long");
      expect(imported?.visibleButtons).toEqual(["length", "thought", "answer", "settings"]);
      expect(imported?.monologue).toEqual({ mode: "semi", maxWindow: 20000 });
      expect(imported?.isBuiltin).toBe(false);
    });

    it("round-trips an array of profiles via exportProfilesToJson and importProfilesFromJson", () => {
      const initial = getPromptProfiles();
      const json = exportProfilesToJson(initial);

      const imported = importProfilesFromJson(json);
      expect(imported.length).toBe(initial.length);
      expect(imported[0].name).toBe(initial[0].name);
      expect(imported[1].name).toBe(initial[1].name);
    });

    it("handles malformed JSON gracefully during import", () => {
      expect(importProfileFromJson("invalid json {}")).toBeNull();
      expect(importProfileFromJson(JSON.stringify({ notAProfile: true }))).toBeNull();
      expect(importProfilesFromJson("bad json")).toEqual([]);
    });

    it("persists saved custom profiles alongside built-ins", () => {
      const custom: PromptProfile = {
        id: "profile-qa-lead",
        name: "QA Lead",
        description: "Testing strategies and automation",
        systemPrompt: "Focus on test coverage and quality metrics",
        humanizerEnabled: true,
        interviewMode: true,
        customStyle: "",
        ragResumeEnabled: false,
        ragJobEnabled: false,
        flushGapMs: 600,
        defaultLength: "short",
        visibleButtons: ["answer", "length"],
        monologue: { mode: "auto", maxWindow: 5000 },
      };

      savePromptProfiles([...getPromptProfiles(), custom]);

      const loaded = getPromptProfiles();
      const found = loaded.find((p) => p.id === "profile-qa-lead");
      expect(found).toBeDefined();
      expect(found?.name).toBe("QA Lead");
      expect(found?.flushGapMs).toBe(600);
    });
  });
});
