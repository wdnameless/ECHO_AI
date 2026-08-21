import { useState } from "react";
import { Header, Button, Label, Input } from "@/components";
import { KeyIcon, TrashIcon, CpuIcon, MicIcon } from "lucide-react";
import { UseSettingsReturn } from "@/types";
import { Providers } from "./Providers";
import { CustomProviders } from "./CustomProvider";
import {
  getGroqFallbackKey,
  setGroqFallbackKey,
} from "@/lib/functions/stt-fallback";
import { useHandyStatus } from "@/hooks/useHandyStatus";
import { cn } from "@/lib/utils";

export const STTProviders = (settings: UseSettingsReturn) => {
  const [groqKey, setGroqKey] = useState<string>(getGroqFallbackKey());
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
            : "Сервер не запущен — используется облачный фоллбек Groq Whisper. Нажмите «Запустить» или перезапустите Pluely."}
        </p>
        {handy.online && handyModelShort && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-1 font-mono">
            <MicIcon className="w-3 h-3" />
            Активная модель: {handyModelShort}
          </div>
        )}
      </div>

      {/* Cloud fallback key (used when the local Handy server is offline) */}
      <div id="stt-fallback" className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3">
        <div className="flex items-center gap-2">
          <KeyIcon className="h-4 w-4 text-muted-foreground" />
          <Label className="text-sm font-medium">Cloud fallback key (Groq)</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Used automatically when the local Handy STT server is not running, so
          voice input keeps working. Get a free key at groq.com.
        </p>
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder="gsk_..."
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={() => {
              setGroqFallbackKey(groqKey);
              alert("Groq fallback key saved.");
            }}
            disabled={!groqKey.trim()}
          >
            Save
          </Button>
          <Button
            size="icon"
            variant="destructive"
            onClick={() => {
              setGroqKey("");
              setGroqFallbackKey("");
            }}
            disabled={!groqKey.trim()}
            title="Remove fallback key"
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Custom Provider */}
      <CustomProviders {...settings} />
      {/* Providers Selection */}
      <Providers {...settings} />
    </div>
  );
};
