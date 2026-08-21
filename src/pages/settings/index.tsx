import {
  Theme,
  AlwaysOnTopToggle,
  AppIconToggle,
  AutostartToggle,
  FontSizeSettings,
  ResumeContext,
  JobContext,
  HumanizerSettings,
} from "./components";
import { PageLayout } from "@/layouts";

const Settings = () => {
  return (
    <PageLayout title="Settings" description="Manage your settings">
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

      {/* My Resume (RAG) */}
      <ResumeContext />

      {/* Job Description (RAG) */}
      <JobContext />

      {/* Humanizer */}
      <HumanizerSettings />
    </PageLayout>
  );
};

export default Settings;
