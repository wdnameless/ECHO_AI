import { Switch, Header } from "@/components";
import { useApp } from "@/contexts";

export const StealthToggle = () => {
  const { customizable, toggleStealthMode } = useApp();

  return (
    <div className="flex flex-row items-center justify-between">
      <Header
        title="Stealth Mode (Скрытность от скриншотов)"
        description="Скрывает окно приложения от захвата экрана и сторонних скриншотов (SetWindowDisplayAffinity). Выключите, если хотите делать скриншоты самого окна Echo AI."
        isMainTitle
      />
      <Switch
        checked={customizable?.stealth?.isEnabled ?? true}
        onCheckedChange={(checked) => toggleStealthMode(checked)}
      />
    </div>
  );
};
