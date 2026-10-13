import { memo, useCallback, useEffect, useState } from "react";
import { AlertCircleIcon, CheckIcon, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SelfLearningToggle } from "@/components/SelfLearningToggle";
import {
  getRuleSource,
  getSelfEvolutionStats,
  type SelfEvolutionStats,
} from "@/lib/storage/user-facts";
import {
  deleteSmartRule,
  getSmartRules,
  type SmartRule,
} from "@/lib/storage/smart-rules";
import {
  BEHAVIOR_SUGGESTION_EVENT,
  confirmSuggestion,
  dismissSuggestion,
  getActiveSuggestions,
  type BehaviorSuggestion,
} from "@/lib/behavior-watch";

export interface SelfEvolutionPopoverProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  stats?: SelfEvolutionStats;
  smartRules?: SmartRule[];
  onDeleteSmartRule?: (id: string) => void;
}

export const SelfEvolutionPopover = memo(function SelfEvolutionPopover({
  open,
  onOpenChange,
  stats: propStats,
  smartRules: propSmartRules,
  onDeleteSmartRule,
}: SelfEvolutionPopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [internalStats, setInternalStats] = useState<SelfEvolutionStats>(() =>
    getSelfEvolutionStats()
  );
  const [internalRules, setInternalRules] = useState<SmartRule[]>(() =>
    getSmartRules()
  );

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const stats = propStats ?? internalStats;
  const smartRules = propSmartRules ?? internalRules;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen && !propStats) {
        setInternalStats(getSelfEvolutionStats());
      }
      if (nextOpen && !propSmartRules) {
        setInternalRules(getSmartRules());
      }
      if (isControlled) {
        onOpenChange?.(nextOpen);
      } else {
        setInternalOpen(nextOpen);
      }
    },
    [isControlled, onOpenChange, propSmartRules, propStats]
  );

  const handleDeleteRule = useCallback(
    (id: string) => {
      if (onDeleteSmartRule) {
        onDeleteSmartRule(id);
      } else {
        deleteSmartRule(id);
        setInternalRules(getSmartRules());
        setInternalStats(getSelfEvolutionStats());
      }
    },
    [onDeleteSmartRule]
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-5 px-1.5 text-[0.62em] gap-1 shrink-0"
          title="Что ИИ выучил из ваших оценок"
        >
          🧠
          {stats.totalEdits > 0 && (
            <span className="font-mono">{stats.totalEdits}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-2 text-[0.68em] space-y-1.5">
        <div className="font-semibold uppercase tracking-wider text-[0.8em] text-muted-foreground border-b border-border/40 pb-1">
          Self-Evolution · что учтено · всего правок: {stats.totalEdits}
        </div>
        <SelfLearningToggle variant="compact" />
        <div className="text-muted-foreground">
          👍 {stats.likes} · 👎 {stats.dislikes} · тон:{" "}
          <span className="text-foreground">{stats.tone}</span>
          {stats.concise && (
            <span className="text-primary"> · максимально кратко</span>
          )}
        </div>
        {stats.favoritePatterns.length > 0 && (
          <div>
            <div className="font-semibold text-emerald-600 dark:text-emerald-400 mb-0.5">
              Эталоны стиля:
            </div>
            {stats.favoritePatterns.map((p, i) => (
              <div key={i} className="truncate text-foreground/80" title={p}>
                • {p}
              </div>
            ))}
          </div>
        )}
        {stats.avoidPatterns.length > 0 && (
          <div>
            <div className="font-semibold text-red-500 mb-0.5">
              Избегать:
            </div>
            {stats.avoidPatterns.map((p, i) => (
              <div key={i} className="truncate text-foreground/80" title={p}>
                • {p}
              </div>
            ))}
          </div>
        )}
        {smartRules.length > 0 ? (
          <div>
            <div className="font-semibold text-violet-500 mb-0.5">
              Личные правила:
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {smartRules.map((r) => {
                const originLabel = r.origin.quote || r.origin.source;
                return (
                  <div
                    key={r.id}
                    className="flex items-start justify-between gap-1 p-1 rounded bg-muted/40 text-[0.95em]"
                    data-testid={`smart-rule-${r.id}`}
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="font-medium text-foreground truncate" title={r.text}>
                        • {r.text}
                      </div>
                      <div className="flex items-center gap-1.5 text-[0.85em] text-muted-foreground flex-wrap">
                        <span
                          className="px-1 py-px rounded bg-violet-500/10 text-violet-500 shrink-0"
                          title="Источник"
                        >
                          источник: {originLabel}
                        </span>
                        <span>хиты: {r.hits}</span>
                        <span>вес: {r.weight}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteRule(r.id)}
                      className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0 transition-colors"
                      title="Удалить правило"
                      aria-label={`Удалить правило ${r.text}`}
                    >
                      <Trash2Icon className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : stats.customRules.length > 0 ? (
          <div>
            <div className="font-semibold text-violet-500 mb-0.5">
              Личные правила:
            </div>
            {stats.customRules.map((r, i) => {
              const src =
                typeof getRuleSource === "function"
                  ? getRuleSource(r)
                  : "manual";
              return (
                <div key={i} className="flex items-center gap-1 truncate text-foreground/80" title={r}>
                  <span className="px-1 py-px rounded text-[0.8em] bg-violet-500/10 text-violet-500 shrink-0">
                    {src}
                  </span>
                  <span className="truncate">• {r}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export interface BehaviorSuggestionBannerProps {
  suggestions?: BehaviorSuggestion[];
  onConfirm?: (id: string) => void;
  onDismiss?: (id: string) => void;
}

export const BehaviorSuggestionBanner = memo(function BehaviorSuggestionBanner({
  suggestions,
  onConfirm,
  onDismiss,
}: BehaviorSuggestionBannerProps) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <>
      {suggestions.map((s) => (
        <div
          key={s.id}
          data-testid={`behavior-suggestion-${s.id}`}
          className="flex items-center justify-between gap-2 px-2 py-1 border-b border-violet-500/30 bg-violet-500/10 text-[0.65em] text-violet-800 dark:text-violet-200 shrink-0 animate-in fade-in"
        >
          <span className="truncate">
            Предложить правило «{s.ruleText}?» ({s.reason})
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onConfirm?.(s.id)}
              className="px-1.5 py-0.5 rounded bg-violet-600 text-white hover:bg-violet-700 font-medium"
            >
              Да
            </button>
            <button
              type="button"
              onClick={() => onDismiss?.(s.id)}
              className="px-1.5 py-0.5 rounded border border-violet-500/40 hover:bg-violet-500/20 font-medium"
            >
              Нет
            </button>
          </div>
        </div>
      ))}
    </>
  );
});

export interface EvolutionNoteBannerProps {
  note?: string | null;
}

export const EvolutionNoteBanner = memo(function EvolutionNoteBanner({
  note,
}: EvolutionNoteBannerProps) {
  if (!note) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 border-b text-[0.65em] shrink-0 animate-in fade-in slide-in-from-top-1",
        note === "Самообучение выключено"
          ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
          : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
      )}
    >
      {note === "Самообучение выключено" ? (
        <AlertCircleIcon className="w-3 h-3 shrink-0" />
      ) : (
        <CheckIcon className="w-3 h-3 shrink-0" />
      )}
      {note}
      {note !== "Самообучение выключено" && " — подход изменён для следующего ответа"}
    </div>
  );
});

export interface UseFeedPopoversOptions {
  onRuleSaved?: () => void;
}

export function useFeedPopovers(options?: UseFeedPopoversOptions) {
  const [evolutionNote, setEvolutionNote] = useState<string | null>(null);
  const [showBrain, setShowBrain] = useState(false);
  const [evoStats, setEvoStats] = useState<SelfEvolutionStats>(() =>
    getSelfEvolutionStats()
  );
  const [smartRules, setSmartRules] = useState<SmartRule[]>(() =>
    getSmartRules()
  );
  const [behaviorSuggestions, setBehaviorSuggestions] = useState<
    BehaviorSuggestion[]
  >(() => getActiveSuggestions());

  const showEvolutionNote = useCallback((msg: string) => {
    setEvolutionNote(msg);
    setTimeout(() => setEvolutionNote(null), 4000);
  }, []);

  const refreshStats = useCallback(() => {
    setEvoStats(getSelfEvolutionStats());
    setSmartRules(getSmartRules());
  }, []);
  const refreshSuggestions = useCallback(() => {
    setBehaviorSuggestions(getActiveSuggestions());
  }, []);

  useEffect(() => {
    const syncSuggestions = () =>
      setBehaviorSuggestions(getActiveSuggestions());
    window.addEventListener(BEHAVIOR_SUGGESTION_EVENT, syncSuggestions);
    return () =>
      window.removeEventListener(BEHAVIOR_SUGGESTION_EVENT, syncSuggestions);
  }, []);

  const handleConfirmSuggestion = useCallback(
    (id: string) => {
      const rule = confirmSuggestion(id);
      setBehaviorSuggestions(getActiveSuggestions());
      if (rule) {
        setSmartRules(getSmartRules());
        setEvoStats(getSelfEvolutionStats());
        showEvolutionNote("Правило сохранено");
        options?.onRuleSaved?.();
      }
    },
    [options, showEvolutionNote]
  );

  const handleDismissSuggestion = useCallback((id: string) => {
    dismissSuggestion(id);
    setBehaviorSuggestions(getActiveSuggestions());
  }, []);

  const handleOpenBrainChange = useCallback((open: boolean) => {
    setShowBrain(open);
    if (open) {
      setEvoStats(getSelfEvolutionStats());
      setSmartRules(getSmartRules());
    }
  }, []);

  const handleDeleteSmartRule = useCallback((id: string) => {
    deleteSmartRule(id);
    setSmartRules(getSmartRules());
    setEvoStats(getSelfEvolutionStats());
  }, []);

  return {
    evolutionNote,
    setEvolutionNote,
    showEvolutionNote,
    showBrain,
    setShowBrain,
    handleOpenBrainChange,
    evoStats,
    setEvoStats,
    smartRules,
    setSmartRules,
    handleDeleteSmartRule,
    behaviorSuggestions,
    setBehaviorSuggestions,
    handleConfirmSuggestion,
    handleDismissSuggestion,
    refreshStats,
    refreshSuggestions,
  };
}

export type FeedPopoversProps = SelfEvolutionPopoverProps;
export const FeedPopovers = SelfEvolutionPopover;
