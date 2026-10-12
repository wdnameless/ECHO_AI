import { Switch, Header } from "@/components";
import { useApp } from "@/contexts";

export const StealthToggle = () => {
  const { customizable, toggleStealthMode } = useApp();

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
