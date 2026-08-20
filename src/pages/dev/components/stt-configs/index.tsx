import { useState } from "react";
import { Header, Button, Label, Input } from "@/components";
import { KeyIcon, TrashIcon } from "lucide-react";
import { UseSettingsReturn } from "@/types";
import { Providers } from "./Providers";
import { CustomProviders } from "./CustomProvider";
import {
  getGroqFallbackKey,
  setGroqFallbackKey,
} from "@/lib/functions/stt-fallback";

export const STTProviders = (settings: UseSettingsReturn) => {
  const [groqKey, setGroqKey] = useState<string>(getGroqFallbackKey());

  return (
    <div id="stt-providers" className="space-y-3">
      <Header
        title="STT Providers"
        description="Select your preferred STT service provider to get started."
        isMainTitle
      />

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
