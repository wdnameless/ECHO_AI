import { useState, useEffect } from "react";
import { Header, Label } from "@/components";
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

  // `mode` is the single switch: the meeting panel shows the same choice, so a
  // second on/off flag here could disagree with it.
  const handleModeChange = (mode: AutoAskConfig["mode"]) => {
    const next = saveAutoAskConfig({ mode });
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
          <div className="flex items-center bg-muted rounded-md p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => handleModeChange("auto")}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-all ${
                config.mode === "auto"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Авто
            </button>
            <button
              type="button"
              onClick={() => handleModeChange("manual")}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-all ${
                config.mode === "manual"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Вручную
            </button>
          </div>
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
              {config.mode === "auto"
                ? "Dispatches speech to AI once a question completes without pressing Ask AI button"
                : "Answers only when you press the button in the meeting panel"}
            </p>
          </div>
        </div>

        {config.mode === "auto" && (
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
              Pause threshold before an answer is sent (default 1.0s). Range: 0.5s - 5.0s.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
