import React, { useState, useEffect, useCallback } from "react";
import { Switch } from "@/components/ui/switch";
import { SparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isSelfLearningEnabled,
  setSelfLearningEnabled,
} from "@/lib/storage/user-facts";

export const SELF_LEARNING_TOGGLE_EVENT = "pluely:self-learning-toggled";

export interface SelfLearningToggleProps {
  /**
   * "full" for Settings page with card, description and status badge.
   * "compact" for SubtitleFeed brain dropdown/popover.
   */
  variant?: "full" | "compact";
  className?: string;
  onToggle?: (enabled: boolean) => void;
}

export const SelfLearningToggle: React.FC<SelfLearningToggleProps> = ({
  variant = "full",
  className,
  onToggle,
}) => {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      return typeof isSelfLearningEnabled === "function"
        ? isSelfLearningEnabled()
        : true;
    } catch {
      return true;
    }
  });

  const handleCheckedChange = useCallback(
    (checked: boolean) => {
      setEnabled(checked);
      try {
        if (typeof setSelfLearningEnabled === "function") {
          setSelfLearningEnabled(checked);
        }
      } catch {
        /* fallback */
      }
      window.dispatchEvent(
        new CustomEvent(SELF_LEARNING_TOGGLE_EVENT, { detail: checked })
      );
      onToggle?.(checked);
    },
    [onToggle]
  );

  useEffect(() => {
    const handleSync = (e: Event) => {
      const custom = e as CustomEvent<boolean>;
      if (typeof custom.detail === "boolean") {
        setEnabled(custom.detail);
      } else {
        try {
          if (typeof isSelfLearningEnabled === "function") {
            setEnabled(isSelfLearningEnabled());
          }
        } catch {
          /* noop */
        }
      }
    };
    window.addEventListener(SELF_LEARNING_TOGGLE_EVENT, handleSync);
    window.addEventListener("storage", handleSync);
    return () => {
      window.removeEventListener(SELF_LEARNING_TOGGLE_EVENT, handleSync);
      window.removeEventListener("storage", handleSync);
    };
  }, []);

  if (variant === "compact") {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-2 p-1.5 rounded-md bg-muted/40 border border-border/30",
          className
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <SparklesIcon
            className={cn(
              "w-3.5 h-3.5 shrink-0 transition-colors",
              enabled ? "text-primary" : "text-muted-foreground"
            )}
          />
          <div className="flex flex-col min-w-0">
            <span className="text-[0.72em] font-medium leading-none truncate">
              Самообучение
            </span>
            <span className="text-[0.6em] text-muted-foreground leading-tight">
              {enabled ? "Включено" : "Выключено"}
            </span>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleCheckedChange}
          aria-label="Переключить самообучение"
          className="scale-75 origin-right"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between p-3 rounded-xl border border-primary/20 bg-primary/5 transition-all",
        className
      )}
    >
      <div className="space-y-0.5 pr-3">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">Самообучение ассистента</span>
          <span
            className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded-full transition-colors",
              enabled
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
            )}
          >
            {enabled ? "Включено" : "Выключено"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Адаптирует стиль и факты под ваши 👍/👎 оценки во всех режимах. При
          выключении обучение и применение блокируются.
        </p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={handleCheckedChange}
        aria-label="Переключить самообучение ассистента"
      />
    </div>
  );
};
