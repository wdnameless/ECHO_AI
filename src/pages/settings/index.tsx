import {
  Theme,
  AlwaysOnTopToggle,
  AppIconToggle,
  AutostartToggle,
  FontSizeSettings,
  PromptProfilesSettings,
  ToolsSettings,
  AiContextSettings,
  JobProfilesSettings,
  ASRDictionarySettings,
  RetentionSettings,
} from "./components";
import { PageLayout } from "@/layouts";

const Settings = () => {
  return (
    <PageLayout title="Settings" description="Manage your settings">
      {/* Prompt Profiles: Interview / General / Self-Evolution / custom */}
      <PromptProfilesSettings />

      {/* Job Profiles: Presets for vacancy & resume context */}
      <JobProfilesSettings />


      {/* ASR Vocabulary & Pronunciation Dictionary */}
      <ASRDictionarySettings />
      {/* Web Search & Skills (Live Research) */}
      <ToolsSettings />

      {/* Data Retention Settings */}
      <RetentionSettings />

      {/* Theme */}
      <Theme />
      {/* Font Size */}
      <FontSizeSettings />

      {/* Autostart Toggle */}
      <AutostartToggle />

      {/* App Icon Toggle */}
      <AppIconToggle />

      {/* Always On Top Toggle */}
      <AlwaysOnTopToggle />

      {/* Unified AI Context: system prompt + resume + job + humanizer */}
      <AiContextSettings />
    </PageLayout>
  );
};

export default Settings;
