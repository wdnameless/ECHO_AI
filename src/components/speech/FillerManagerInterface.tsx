import React from "react";
import { useFillerManager } from "@/hooks/useFillerManager";
import { Volume2, VolumeX, Sparkles, Clock } from "lucide-react";

export interface FillerManagerInterfaceProps {
  className?: string;
}

export const FillerManagerInterface: React.FC<FillerManagerInterfaceProps> = ({
  className = "",
}) => {
  const { activeFiller, isPlaying, config, updateConfig, stop } = useFillerManager();

  return (
    <div
      className={`rounded-lg border border-border/40 bg-card/60 p-3 shadow-sm backdrop-blur-sm transition-all ${className}`}
      data-testid="filler-manager-interface"
    >
      <div className="flex items-center justify-between pb-2 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <span className="text-xs font-semibold tracking-wide text-foreground">
            Filler Manager
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => updateConfig({ audioPlaybackEnabled: !config.audioPlaybackEnabled })}
            className={`p-1 rounded hover:bg-accent/50 transition-colors ${
              config.audioPlaybackEnabled ? "text-violet-400" : "text-muted-foreground"
            }`}
            title={config.audioPlaybackEnabled ? "Audio TTS Enabled" : "Audio TTS Disabled"}
          >
            {config.audioPlaybackEnabled ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
          </button>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              config.enabled
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {config.enabled ? "Active" : "Disabled"}
          </span>
        </div>
      </div>

      <div className="mt-2 space-y-2 text-xs">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" /> Latency Trigger:
          </span>
          <span className="font-mono text-[11px] text-foreground">
            &gt; {config.latencyThresholdMs / 1000}s
          </span>
        </div>

        {activeFiller && (
          <div className="mt-2 rounded bg-violet-500/10 border border-violet-500/30 p-2 text-xs flex items-center justify-between animate-fadeIn">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
              </span>
              <span className="font-medium text-violet-200 truncate italic">
                «{activeFiller}»
              </span>
            </div>
            {isPlaying && (
              <button
                type="button"
                onClick={stop}
                className="text-[10px] text-violet-300 hover:text-white underline ml-2 shrink-0"
              >
                Stop
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
