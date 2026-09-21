import { Dispatch, SetStateAction } from "react";
import { ScreenshotConfig, TYPE_PROVIDER } from "@/types";
import { CursorType, CustomizableState } from "@/lib/storage";
import { PromptProfile } from "@/lib/storage/prompt-profiles";
import { JobProfile } from "@/lib/storage/job-profiles";

export type IContextType = {
  systemPrompt: string;
  setSystemPrompt: Dispatch<SetStateAction<string>>;
  allAiProviders: TYPE_PROVIDER[];
  customAiProviders: TYPE_PROVIDER[];
  selectedAIProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  onSetSelectedAIProvider: ({
    provider,
    variables,
  }: {
    provider: string;
    variables: Record<string, string>;
  }) => void;
  allSttProviders: TYPE_PROVIDER[];
  customSttProviders: TYPE_PROVIDER[];
  selectedSttProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  onSetSelectedSttProvider: ({
    provider,
    variables,
  }: {
    provider: string;
    variables: Record<string, string>;
  }) => void;
  screenshotConfiguration: ScreenshotConfig;
  setScreenshotConfiguration: React.Dispatch<
    React.SetStateAction<ScreenshotConfig>
  >;
  customizable: CustomizableState;
  toggleAppIconVisibility: (isVisible: boolean) => Promise<void>;
  toggleAlwaysOnTop: (isEnabled: boolean) => Promise<void>;
  toggleAutostart: (isEnabled: boolean) => Promise<void>;
  toggleStealthMode: (isEnabled: boolean) => Promise<void>;
  loadData: () => void;
  pluelyApiEnabled: boolean;
  setPluelyApiEnabled: (enabled: boolean) => Promise<void>;
  hasActiveLicense: boolean;
  setHasActiveLicense: Dispatch<SetStateAction<boolean>>;
  getActiveLicenseStatus: () => Promise<boolean>;
  selectedAudioDevices: {
    input: { id: string; name: string };
    output: { id: string; name: string };
  };
  setSelectedAudioDevices: Dispatch<
    SetStateAction<{
      input: { id: string; name: string };
      output: { id: string; name: string };
    }>
  >;
  setCursorType: (type: CursorType) => void;
  supportsImages: boolean;
  setSupportsImages: (value: boolean) => void;
  promptProfiles: PromptProfile[];
  activeProfileId: string;
  selectPromptProfile: (profileId: string) => void;
  updatePromptProfile: (profileId: string, updates: Partial<PromptProfile>) => void;
  createPromptProfile: (profile: Omit<PromptProfile, "id">) => PromptProfile;
  deletePromptProfile: (profileId: string) => void;
  /** Restores a built-in profile to the prompt shipped with the app. */
  resetPromptProfile: (profileId: string) => void;
  /** Re-reads prompt profiles from storage (used after restoring deleted built-ins). */
  refreshPromptProfiles: () => void;
  jobProfiles: JobProfile[];
  activeJobProfileId: string;
  activeJobProfile: JobProfile | null;
  selectJobProfile: (profileId: string) => void;
  updateJobProfile: (profileId: string, updates: Partial<JobProfile>) => void;
  createJobProfile: (profile: Omit<JobProfile, "id">) => JobProfile;
  deleteJobProfile: (profileId: string) => void;
  applyJobProfile: (profileId: string) => void;
  /** Re-reads job profiles from storage (used after restoring deleted built-ins). */
  refreshJobProfiles: () => void;
};
