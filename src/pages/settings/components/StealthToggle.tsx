import { Switch, Header } from "@/components";
import { useStealthStore } from "@/stores";

export const StealthToggle = () => {
  const customizable = useStealthStore((s) => s.customizable);
  const toggleStealthMode = useStealthStore((s) => s.toggleStealthMode);
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
