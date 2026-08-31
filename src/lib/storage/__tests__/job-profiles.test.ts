import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_JOB_PROFILES,
  getJobProfiles,
  saveJobProfiles,
  getActiveJobProfileId,
  setActiveJobProfileId,
  getActiveJobProfile,
  applyJobProfileToStorage,
  JobProfile,
} from "../job-profiles";
import { STORAGE_KEYS } from "@/config";

describe("JobProfiles Storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should return default job profiles when localStorage is empty", () => {
    const profiles = getJobProfiles();
    expect(profiles).toHaveLength(DEFAULT_JOB_PROFILES.length);
    expect(profiles[0].id).toBe("frontend-senior");
    expect(profiles[1].id).toBe("backend-engineer");
    expect(profiles[2].id).toBe("system-design-techlead");
    expect(profiles[3].id).toBe("blank-profile");
  });

  it("should get and set active job profile id", () => {
    expect(getActiveJobProfileId()).toBe("frontend-senior");
    setActiveJobProfileId("backend-engineer");
    expect(getActiveJobProfileId()).toBe("backend-engineer");
  });

  it("should save and retrieve custom job profiles", () => {
    const customProfiles: JobProfile[] = [
      ...DEFAULT_JOB_PROFILES,
      {
        id: "custom-1",
        name: "Custom Profile",
        description: "Test description",
        contextContent: "Custom resume and job text",
      },
    ];

    saveJobProfiles(customProfiles);
    const retrieved = getJobProfiles();
    expect(retrieved).toHaveLength(DEFAULT_JOB_PROFILES.length + 1);
    expect(retrieved.find((p) => p.id === "custom-1")).toBeDefined();
    expect(retrieved.find((p) => p.id === "custom-1")?.contextContent).toBe(
      "Custom resume and job text"
    );
  });

  it("should retrieve active job profile object", () => {
    setActiveJobProfileId("backend-engineer");
    const active = getActiveJobProfile();
    expect(active).not.toBeNull();
    expect(active?.id).toBe("backend-engineer");
    expect(active?.name).toContain("Backend");
  });

  it("should apply job profile to storage (SYSTEM_AUDIO_CONTEXT)", () => {
    const profile: JobProfile = {
      id: "test-profile",
      name: "Test Profile",
      contextContent: "Detailed experience in React, TypeScript, Rust.",
    };

    applyJobProfileToStorage(profile);

    const savedAudioContext = localStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT
    );
    expect(savedAudioContext).not.toBeNull();

    const parsed = JSON.parse(savedAudioContext!);
    expect(parsed.contextContent).toBe(
      "Detailed experience in React, TypeScript, Rust."
    );
    expect(parsed.useSystemPrompt).toBe(true);

    const activeId = localStorage.getItem(STORAGE_KEYS.ACTIVE_JOB_PROFILE_ID);
    expect(activeId).toBe("test-profile");
  });

  it("should handle corrupt JSON gracefully in getJobProfiles", () => {
    localStorage.setItem(STORAGE_KEYS.JOB_PROFILES, "invalid-json{{{");
    const profiles = getJobProfiles();
    expect(profiles).toHaveLength(DEFAULT_JOB_PROFILES.length);
  });
});
