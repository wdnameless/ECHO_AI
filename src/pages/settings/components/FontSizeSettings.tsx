import { useState, useEffect } from "react";
import { Header, Label, Button } from "@/components";
import { TypeIcon } from "lucide-react";
import { safeLocalStorage } from "@/lib/storage/helper";

export const FONT_SIZE_STORAGE_KEY = "app_font_size";

export type FontSizeOption = "sm" | "base" | "lg" | "xl";

export interface FontSizeConfig {
  size: FontSizeOption;
  label: string;
  px: number;
}

export const FONT_SIZE_OPTIONS: FontSizeConfig[] = [
  { size: "sm", label: "Small", px: 13 },
  { size: "base", label: "Default", px: 15 },
  { size: "lg", label: "Large", px: 17 },
  { size: "xl", label: "Extra Large", px: 19 },
];

export function applyFontSize(size: FontSizeOption) {
  const opt = FONT_SIZE_OPTIONS.find((o) => o.size === size) || FONT_SIZE_OPTIONS[1];
  if (typeof document !== "undefined") {
    document.documentElement.style.fontSize = `${opt.px}px`;
    document.documentElement.style.setProperty("--app-font-size", `${opt.px}px`);
  }
}

export const FontSizeSettings = () => {
  const [currentSize, setCurrentSize] = useState<FontSizeOption>(() => {
    return (safeLocalStorage.getItem(FONT_SIZE_STORAGE_KEY) as FontSizeOption) || "base";
  });

  useEffect(() => {
    applyFontSize(currentSize);
  }, [currentSize]);

  const handleChange = (size: FontSizeOption) => {
    setCurrentSize(size);
    safeLocalStorage.setItem(FONT_SIZE_STORAGE_KEY, size);
    applyFontSize(size);
  };

  return (
    <div id="font-size" className="space-y-2">
      <Header
        title="Interface Font Size"
        description="Adjust the text scale across the application for comfortable reading"
      />
      <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 p-3">
        <div className="flex items-center space-x-3">
          <TypeIcon className="h-5 w-5 text-muted-foreground" />
          <div>
            <Label className="text-sm font-medium">Text Scale</Label>
            <p className="text-xs text-muted-foreground">
              Current: {FONT_SIZE_OPTIONS.find((o) => o.size === currentSize)?.label} (
              {FONT_SIZE_OPTIONS.find((o) => o.size === currentSize)?.px}px)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {FONT_SIZE_OPTIONS.map((opt) => (
            <Button
              key={opt.size}
              size="sm"
              variant={currentSize === opt.size ? "default" : "outline"}
              className="h-8 px-2.5 text-xs"
              onClick={() => handleChange(opt.size)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
};
