import {
  ResponseLength,
  LanguageSelector,
  AutoScrollToggle,
} from "./components";
import { PageLayout } from "@/layouts";
import { useApp } from "@/contexts";
import { canUseFeature, isDevBuild } from "@/lib/entitlements";
import { UpgradePrompt } from "@/components";

const Responses = () => {
  const { hasActiveLicense } = useApp();
  // Каждый контрол ниже сам объясняет свою недоступность (R17), поэтому
  // общего блокирующего баннера нет — он дублировал бы пояснения.
  const anyProAvailable =
    canUseFeature("responseLength", {
      isDevBuild: isDevBuild(),
      hasLicense: hasActiveLicense,
    }) ||
    canUseFeature("language", {
      isDevBuild: isDevBuild(),
      hasLicense: hasActiveLicense,
    });

  return (
    <PageLayout
      title="Response Settings"
      description="Customize how AI generates and displays responses"
    >
      {!anyProAvailable && (
        <UpgradePrompt feature="Настройка ответов (длина, язык, авто-скролл)" />
      )}

      {/* Response Length */}
      <ResponseLength />

      {/* Language Selector */}
      <LanguageSelector />

      {/* Auto-Scroll Toggle */}
      <AutoScrollToggle />
    </PageLayout>
  );
};

export default Responses;
