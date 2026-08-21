import { Header, Label } from "@/components";
import { CpuIcon, MicIcon, HardDriveIcon } from "lucide-react";
import { UseSettingsReturn } from "@/types";
import { Providers } from "./Providers";
import { CustomProviders } from "./CustomProvider";
import { useHandyStatus } from "@/hooks/useHandyStatus";
import { cn } from "@/lib/utils";

export const STTProviders = (settings: UseSettingsReturn) => {
  const handy = useHandyStatus(5000);

  const handyModelShort = handy.model
    ? handy.model.split("/").pop()?.replace(".gguf", "") || handy.model
    : "";

  return (
    <div id="stt-providers" className="space-y-3">
      <Header
        title="STT Providers"
        description="Select your preferred STT service provider to get started."
        isMainTitle
      />

      {/* Handy Local STT status card with active model */}
      <div
        className={cn(
          "space-y-2 rounded-lg border p-3",
          handy.online
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-border/50 bg-muted/20"
        )}
      >
        <div className="flex items-center gap-2">
          {handy.online ? (
            <CpuIcon className="h-4 w-4 text-emerald-500" />
          ) : (
            <CpuIcon className="h-4 w-4 text-muted-foreground" />
          )}
          <Label className="text-sm font-medium">
            Handy Local STT (GPU)
          </Label>
          <span
            className={cn(
              "flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ml-auto",
              handy.online
                ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                : "text-red-500 bg-red-500/10 border-red-500/30"
            )}
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                handy.online ? "bg-emerald-500 animate-pulse" : "bg-red-500"
              )}
            />
            {handy.online ? "Online" : "Offline"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {handy.online
            ? "Local Nemotron 3.5 ASR Streaming на Vulkan GPU (RTX 3060). Распознавание ~40x real-time, живые субтитры."
            : "Сервер не запущен — распознавание недоступно. Перезапустите Pluely, сервер стартует автоматически."}
        </p>
        {handy.online && handyModelShort && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-1 font-mono">
            <MicIcon className="w-3 h-3" />
            Активная модель: {handyModelShort}
          </div>
        )}
      </div>

      {/* Local fallback chain - no cloud, no 429 */}
      <div
        className={cn(
          "space-y-2 rounded-lg border p-3",
          handy.online
            ? "border-border/50 bg-muted/10"
            : "border-amber-500/40 bg-amber-500/5"
        )}
      >
        <div className="flex items-center gap-2">
          <HardDriveIcon className="h-4 w-4 text-muted-foreground" />
          <Label className="text-sm font-medium">
            Local Offline Fallback (CPU Whisper)
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Если GPU-модель Handy не отвечает, сервер автоматически
          распознаёт аудио через локальную модель{" "}
          <code className="font-mono text-[10px] bg-muted/40 px-1 rounded">
            openai-whisper (base)
          </code>{" "}
          на CPU. Без облака, без API-ключей и без лимитов (429).
        </p>
      </div>

      {/* Custom Provider */}
      <CustomProviders {...settings} />
      {/* Providers Selection */}
      <Providers {...settings} />
    </div>
  );
};
