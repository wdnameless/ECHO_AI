import { useState, useEffect } from "react";
import { Header, Label } from "@/components";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { SparklesIcon } from "lucide-react";
import {
  getAutoAskConfig,
  saveAutoAskConfig,
  AUTO_ASK_MIN_SILENCE_MS,
  AUTO_ASK_MAX_SILENCE_MS,
  AutoAskConfig,
} from "@/lib/auto-ask";

export const AutoAskSettings = () => {
  const [config, setConfig] = useState<AutoAskConfig>(() => getAutoAskConfig());

  useEffect(() => {
    setConfig(getAutoAskConfig());
  }, []);

  const handleToggle = (enabled: boolean) => {
    const next = saveAutoAskConfig({ enabled });
    setConfig(next);
  };

  const handleSilenceChange = (values: number[]) => {
    const silenceDurationMs = values[0];
    if (silenceDurationMs !== undefined) {
      const next = saveAutoAskConfig({ silenceDurationMs });
      setConfig(next);
    }
  };

  return (
    <div id="auto-ask" className="space-y-3">
      <Header
        title="Auto-Ask Assistant"
        description="Automatically trigger AI answer when interviewer pauses speaking"
        rightSlot={
          <Switch
            checked={config.enabled}
            onCheckedChange={handleToggle}
            aria-label="Toggle Auto-Ask Assistant"
          />
        }
      />

      <div className="space-y-4 rounded-lg border border-border/50 bg-muted/20 p-3">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-md bg-background border border-border/50 text-muted-foreground">
            <SparklesIcon className="w-4 h-4" />
          </div>
          <div>
            <Label className="text-sm font-medium">Automatic Query Dispatch</Label>
            <p className="text-xs text-muted-foreground">
              Dispatches speech to AI once a question completes without pressing Ask AI button
            </p>
          </div>
        </div>

        {config.enabled && (
          <div className="space-y-2 pt-2 border-t border-border/50">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground font-medium">
                Silence Duration Before Ask
              </Label>
              <span className="text-xs font-mono text-muted-foreground">
                {(config.silenceDurationMs / 1000).toFixed(1)}s ({config.silenceDurationMs}ms)
              </span>
            </div>
            <Slider
              value={[config.silenceDurationMs]}
              min={AUTO_ASK_MIN_SILENCE_MS}
              max={AUTO_ASK_MAX_SILENCE_MS}
              step={100}
              onValueChange={handleSilenceChange}
              className="py-1"
            />
            <p className="text-[11px] text-muted-foreground">
              Pause threshold to detect end of question (default 1.5s). Range: 0.5s - 5.0s.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
