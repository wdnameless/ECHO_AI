import React, { useEffect, useState } from "react";
import { Switch, Textarea } from "@/components/ui";
import {
  getFillerFilterConfig,
  saveFillerFilterConfig,
  FillerFilterConfig,
} from "@/lib/filler-filter";

export const FillerFilterSettings: React.FC = () => {
  const [config, setConfig] = useState<FillerFilterConfig>(() => getFillerFilterConfig());

  useEffect(() => {
    setConfig(getFillerFilterConfig());
  }, []);

  const handleToggleAi = (checked: boolean) => {
    const updated = saveFillerFilterConfig({ filterAiEnabled: checked });
    setConfig(updated);
  };

  const handleToggleFeed = (checked: boolean) => {
    const updated = saveFillerFilterConfig({ filterFeedEnabled: checked });
    setConfig(updated);
  };

  const handleCustomFillersChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const updated = saveFillerFilterConfig({ customFillers: val });
    setConfig(updated);
  };

  return (
    <div className="space-y-4 rounded-lg border border-border/50 bg-card/30 p-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">
          Фильтр слов-паразитов (Filler Filter)
        </h3>
        <p className="text-sm text-muted-foreground">
          Удаляет междометия и слова-паразиты («ээ», «эм», «типа», «как бы», «um», «uh», «you know») из распознанной речи.
        </p>
      </div>

      <div className="flex items-center justify-between space-x-2 pt-2">
        <div className="space-y-0.5">
          <label
            htmlFor="filler-filter-ai-toggle"
            className="text-sm font-medium text-foreground cursor-pointer"
          >
            Очищать перед отправкой в AI (Default: ON)
          </label>
          <p className="text-xs text-muted-foreground">
            Удаляет слова-паразиты из запросов к ассистенту для более точных ответов.
          </p>
        </div>
        <Switch
          id="filler-filter-ai-toggle"
          checked={config.filterAiEnabled}
          onCheckedChange={handleToggleAi}
        />
      </div>

      <div className="flex items-center justify-between space-x-2 pt-2">
        <div className="space-y-0.5">
          <label
            htmlFor="filler-filter-feed-toggle"
            className="text-sm font-medium text-foreground cursor-pointer"
          >
            Очищать в ленте транскрипта (Default: OFF)
          </label>
          <p className="text-xs text-muted-foreground">
            При выключении в ленте сохраняется дословная речь без искажения оригинала.
          </p>
        </div>
        <Switch
          id="filler-filter-feed-toggle"
          checked={config.filterFeedEnabled}
          onCheckedChange={handleToggleFeed}
        />
      </div>

      <div className="space-y-2 pt-2">
        <label
          htmlFor="custom-fillers-input"
          className="text-sm font-medium text-foreground"
        >
          Пользовательские слова-паразиты (через запятую)
        </label>
        <Textarea
          id="custom-fillers-input"
          value={config.customFillers}
          onChange={handleCustomFillersChange}
          placeholder="в общем, собственно, so to speak, basically"
          rows={3}
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Дополнительные слова или фразы, которые будут удаляться в дополнение к стандартному набору.
        </p>
      </div>
    </div>
  );
};
