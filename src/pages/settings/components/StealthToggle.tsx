import { Switch, Header } from "@/components";
import { useApp } from "@/contexts";
import type { IContextType } from "@/types";
import { useStealthStore } from "@/stores";

export const StealthToggle = () => {
  const storeCustomizable = useStealthStore((s) => s.customizable);
  const storeToggleStealthMode = useStealthStore((s) => s.toggleStealthMode);
  let contextApp: Partial<IContextType> | undefined;
  try {
    contextApp = useApp();
  } catch {
    // outside AppProvider
  }
  const customizable = contextApp?.customizable ?? storeCustomizable;
  const toggleStealthMode =
    contextApp?.toggleStealthMode ?? storeToggleStealthMode;

  return (
    <div className="flex flex-row items-center justify-between">
      <Header
        title="Stealth Mode (Скрытность от скриншотов и переключателя)"
        description="Скрывает главное и вспомогательные окна от захвата экрана, демонстрации и переключателя задач (Alt-Tab/Dock). Процесс приложения остаётся под своим именем."
        isMainTitle
      />
      <Switch
        checked={customizable?.stealth?.isEnabled ?? false}
        onCheckedChange={(checked) => toggleStealthMode(checked)}
      />
    </div>
  );
};
