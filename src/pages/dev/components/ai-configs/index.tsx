import { Header, Card } from "@/components";
import { UseSettingsReturn } from "@/types";
import { Providers } from "./Providers";
import { CustomProviders } from "./CustomProvider";

export const AIProviders = (settings: UseSettingsReturn) => {
  return (
    <div id="ai-providers" className="space-y-3">
      <Header
        title="AI Providers"
        description="Один интерфейс: выберите провайдера, укажите ключ и модель, проверьте тестовым запросом."
        isMainTitle
      />

      {/* A single block: the active provider's credentials on top, the custom
          provider editor underneath. These used to be two separate sections that
          both read as "add a provider". */}
      <Card className="p-4 border bg-card/40 border-border/80 rounded-xl space-y-4">
        <Providers {...settings} />
        <div className="border-t border-border/60 pt-4">
          <CustomProviders {...settings} />
        </div>
      </Card>
    </div>
  );
};
