import { create } from "zustand";
import { registerStoreReset } from "./reset";
import {
  DEFAULT_SYSTEM_PROMPT,
  STORAGE_KEYS,
} from "@/config";
import { safeLocalStorage } from "@/lib";
import {
  applyProfileToStorage,
  BUILTIN_PROFILES,
  getActiveProfile,
  getActiveProfileId,
  getPromptProfiles,
  PromptProfile,
  removeBuiltinProfile,
  restoreBuiltinProfile,
  savePromptProfiles,
  setActiveProfileId,
} from "@/lib/storage/prompt-profiles";
import {
  applyJobProfileToStorage,
  getActiveJobProfileId,
  getJobProfiles,
  JobProfile,
  removeBuiltinJobProfile,
  saveJobProfiles,
  setActiveJobProfileId,
} from "@/lib/storage/job-profiles";

export interface ProfilesState {
  systemPrompt: string;
  promptProfiles: PromptProfile[];
  activeProfileId: string;
  jobProfiles: JobProfile[];
  activeJobProfileId: string;
  activeJobProfile: JobProfile | null;

  setSystemPrompt: (updater: string | ((prev: string) => string)) => void;
  selectPromptProfile: (profileId: string) => void;
  updatePromptProfile: (profileId: string, updates: Partial<PromptProfile>) => void;
  createPromptProfile: (profile: Omit<PromptProfile, "id">) => PromptProfile;
  deletePromptProfile: (profileId: string) => void;
  resetPromptProfile: (profileId: string) => void;
  refreshPromptProfiles: () => void;

  selectJobProfile: (profileId: string) => void;
  applyJobProfile: (profileId: string) => void;
  updateJobProfile: (profileId: string, updates: Partial<JobProfile>) => void;
  createJobProfile: (profile: Omit<JobProfile, "id">) => JobProfile;
  deleteJobProfile: (profileId: string) => void;
  refreshJobProfiles: () => void;
  loadProfilesData: () => void;
}

export const useProfilesStore = create<ProfilesState>((set, get) => {
  const initialActiveJobProfileId = getActiveJobProfileId();
  const initialJobProfiles = getJobProfiles();
  const initialActiveJobProfile =
    initialJobProfiles.find((p) => p.id === initialActiveJobProfileId) || null;

  return {
    systemPrompt:
      safeLocalStorage.getItem(STORAGE_KEYS.SYSTEM_PROMPT) ||
      DEFAULT_SYSTEM_PROMPT,
    promptProfiles: getPromptProfiles(),
    activeProfileId: getActiveProfileId(),
    jobProfiles: initialJobProfiles,
    activeJobProfileId: initialActiveJobProfileId,
    activeJobProfile: initialActiveJobProfile,

    setSystemPrompt: (updater: string | ((prev: string) => string)) => {
      const next =
        typeof updater === "function" ? updater(get().systemPrompt) : updater;
      safeLocalStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, next);
      set({ systemPrompt: next });
    },

    selectPromptProfile: (profileId: string) => {
      const profiles = getPromptProfiles();
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return;
      setActiveProfileId(profileId);
      applyProfileToStorage(profile);
      safeLocalStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, profile.systemPrompt);
      set({
        activeProfileId: profileId,
        systemPrompt: profile.systemPrompt,
        promptProfiles: getPromptProfiles(),
      });
    },

    updatePromptProfile: (
      profileId: string,
      updates: Partial<PromptProfile>
    ) => {
      const profiles = getPromptProfiles();
      const idx = profiles.findIndex((p) => p.id === profileId);
      if (idx === -1) return;
      const updated = { ...profiles[idx], ...updates };
      profiles[idx] = updated;
      savePromptProfiles(profiles);
      const isActive = profileId === getActiveProfileId();
      if (isActive) {
        applyProfileToStorage(updated);
        safeLocalStorage.setItem(
          STORAGE_KEYS.SYSTEM_PROMPT,
          updated.systemPrompt
        );
      }
      set({
        promptProfiles: profiles,
        ...(isActive ? { systemPrompt: updated.systemPrompt } : {}),
      });
    },

    createPromptProfile: (
      profile: Omit<PromptProfile, "id">
    ): PromptProfile => {
      const newProfile: PromptProfile = {
        ...profile,
        id: `profile-${Date.now().toString(36)}`,
      };
      const profiles = [...getPromptProfiles(), newProfile];
      savePromptProfiles(profiles);
      set({ promptProfiles: profiles });
      return newProfile;
    },

    refreshPromptProfiles: () => {
      set({
        promptProfiles: getPromptProfiles(),
        activeProfileId: getActiveProfileId(),
      });
    },

    deletePromptProfile: (profileId: string) => {
      const current = getPromptProfiles();
      if (current.length <= 1) return;
      const target = current.find((p) => p.id === profileId);
      if (!target) return;

      if (target.isBuiltin) removeBuiltinProfile(profileId);

      const profiles = current.filter((p) => p.id !== profileId);
      savePromptProfiles(profiles);

      let nextActiveId = get().activeProfileId;
      let nextPrompt = get().systemPrompt;

      if (profileId === getActiveProfileId()) {
        const fallback = profiles.find((p) => p.isBuiltin) || profiles[0];
        if (fallback) {
          setActiveProfileId(fallback.id);
          applyProfileToStorage(fallback);
          safeLocalStorage.setItem(
            STORAGE_KEYS.SYSTEM_PROMPT,
            fallback.systemPrompt
          );
          nextActiveId = fallback.id;
          nextPrompt = fallback.systemPrompt;
        }
      }

      set({
        promptProfiles: profiles,
        activeProfileId: nextActiveId,
        systemPrompt: nextPrompt,
      });
    },

    resetPromptProfile: (profileId: string) => {
      const factory = BUILTIN_PROFILES.find((p) => p.id === profileId);
      if (!factory) return;
      restoreBuiltinProfile(profileId);

      const profiles = getPromptProfiles().map((p) =>
        p.id === profileId ? { ...factory } : p
      );
      savePromptProfiles(profiles);

      let nextPrompt = get().systemPrompt;
      if (profileId === getActiveProfileId()) {
        applyProfileToStorage(factory);
        safeLocalStorage.setItem(
          STORAGE_KEYS.SYSTEM_PROMPT,
          factory.systemPrompt
        );
        nextPrompt = factory.systemPrompt;
      }

      set({
        promptProfiles: profiles,
        systemPrompt: nextPrompt,
      });
    },

    applyJobProfile: (profileId: string) => {
      const profiles = getJobProfiles();
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return;
      setActiveJobProfileId(profileId);
      applyJobProfileToStorage(profile);
      const reloaded = getJobProfiles();
      set({
        activeJobProfileId: profileId,
        jobProfiles: reloaded,
        activeJobProfile: profile,
      });
    },

    selectJobProfile: (profileId: string) => {
      get().applyJobProfile(profileId);
    },

    updateJobProfile: (profileId: string, updates: Partial<JobProfile>) => {
      const profiles = getJobProfiles();
      const idx = profiles.findIndex((p) => p.id === profileId);
      if (idx === -1) return;
      const updated = { ...profiles[idx], ...updates };
      profiles[idx] = updated;
      saveJobProfiles(profiles);
      const isActive = profileId === getActiveJobProfileId();
      if (isActive) {
        applyJobProfileToStorage(updated);
      }
      set({
        jobProfiles: profiles,
        ...(isActive ? { activeJobProfile: updated } : {}),
      });
    },

    createJobProfile: (profile: Omit<JobProfile, "id">): JobProfile => {
      const newProfile: JobProfile = {
        ...profile,
        id: `job-profile-${Date.now().toString(36)}`,
      };
      const profiles = [...getJobProfiles(), newProfile];
      saveJobProfiles(profiles);
      set({ jobProfiles: profiles });
      return newProfile;
    },

    refreshJobProfiles: () => {
      const profiles = getJobProfiles();
      const activeId = getActiveJobProfileId();
      set({
        jobProfiles: profiles,
        activeJobProfileId: activeId,
        activeJobProfile: profiles.find((p) => p.id === activeId) || null,
      });
    },

    deleteJobProfile: (profileId: string) => {
      const current = getJobProfiles();
      if (current.length <= 1) return;
      const target = current.find((p) => p.id === profileId);
      if (!target) return;

      if (target.isBuiltin) removeBuiltinJobProfile(profileId);

      const profiles = current.filter((p) => p.id !== profileId);
      saveJobProfiles(profiles);

      let nextActiveId = get().activeJobProfileId;
      let nextActiveJob = get().activeJobProfile;

      if (profileId === getActiveJobProfileId()) {
        const fallback = profiles[0];
        if (fallback) {
          setActiveJobProfileId(fallback.id);
          applyJobProfileToStorage(fallback);
          nextActiveId = fallback.id;
          nextActiveJob = fallback;
        }
      }

      set({
        jobProfiles: profiles,
        activeJobProfileId: nextActiveId,
        activeJobProfile: nextActiveJob,
      });
    },

    loadProfilesData: () => {
      const savedSystemPrompt = safeLocalStorage.getItem(
        STORAGE_KEYS.SYSTEM_PROMPT
      );
      const activePromptProf = getActiveProfile();
      const pps = getPromptProfiles();
      const actProfId = getActiveProfileId();
      const jps = getJobProfiles();
      const actJobId = getActiveJobProfileId();
      set({
        systemPrompt:
          savedSystemPrompt ||
          activePromptProf.systemPrompt ||
          DEFAULT_SYSTEM_PROMPT,
        promptProfiles: pps,
        activeProfileId: actProfId,
        jobProfiles: jps,
        activeJobProfileId: actJobId,
        activeJobProfile: jps.find((p) => p.id === actJobId) || null,
      });
    },
  };
});

export const initialProfilesState: ProfilesState = useProfilesStore.getState();

export const resetProfilesStore = () => {
  useProfilesStore.setState(initialProfilesState, true);
};

registerStoreReset(resetProfilesStore);
