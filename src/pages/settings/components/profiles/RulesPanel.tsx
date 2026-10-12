import React, { useState } from "react";
import { Button, Label, Input } from "@/components";
import { Trash2Icon, AlertTriangleIcon, SparklesIcon, ShieldAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SmartRule,
  RuleSource,
  getSmartRules,
  deleteSmartRule,
  archiveSmartRule,
  findConflictingRule,
} from "@/lib/storage/smart-rules";
import {
  addUserRule,
  getUserStylePreferences,
  saveUserStylePreferences,
  getRuleSource,
} from "@/lib/storage/user-facts";

export interface RulesPanelProps {
  onChange?: () => void;
}

export const RulesPanel: React.FC<RulesPanelProps> = ({ onChange }) => {
  const [, setTick] = useState(0);
  const [newRuleText, setNewRuleText] = useState("");
  const [conflict, setConflict] = useState<{
    newText: string;
    existing: SmartRule;
  } | null>(null);

  let rules: SmartRule[] = [];
  try {
    rules = getSmartRules();
  } catch {
    rules = [];
  }

  let legacyRules: string[] = [];
  try {
    legacyRules = getUserStylePreferences()?.customRules ?? [];
  } catch {
    legacyRules = [];
  }

  const refresh = () => {
    setTick((t) => t + 1);
    onChange?.();
  };

  const resolveRuleSource = (rule: string): RuleSource => {
    if (typeof getRuleSource === "function") {
      const src = getRuleSource(rule);
      if (src) return src;
    }
    return "manual";
  };

  const handleAddRule = (text: string, source: RuleSource = "manual") => {
    if (typeof addUserRule === "function") {
      addUserRule(text, { source });
    }
    try {
      const style = getUserStylePreferences();
      if (style) {
        saveUserStylePreferences({
          ...style,
          customRules: [text, ...(style.customRules ?? []).filter((r) => r !== text)],
        });
      }
    } catch {
      // Fallback
    }
    refresh();
  };

  const handleDeleteRule = (id: string) => {
    try {
      deleteSmartRule(id);
    } catch {
      // Fallback
    }
    refresh();
  };

  const handleArchiveRule = (id: string) => {
    try {
      archiveSmartRule(id);
    } catch {
      // Fallback
    }
    refresh();
  };

  const handleRemoveLegacyRule = (index: number) => {
    try {
      const style = getUserStylePreferences();
      if (style) {
        saveUserStylePreferences({
          ...style,
          customRules: (style.customRules ?? []).filter((_, i) => i !== index),
        });
      }
    } catch {
      // Fallback
    }
    refresh();
  };

  const handleAttemptAdd = () => {
    const text = newRuleText.trim();
    if (!text) return;

    const conflicting = findConflictingRule(text);
    if (conflicting) {
      setConflict({ newText: text, existing: conflicting });
      return;
    }

    handleAddRule(text, "manual");
    setNewRuleText("");
  };

  const handleResolveConflictReplace = () => {
    if (!conflict) return;
    handleDeleteRule(conflict.existing.id);
    handleAddRule(conflict.newText, "manual");
    setConflict(null);
    setNewRuleText("");
  };

  const handleResolveConflictKeepBoth = () => {
    if (!conflict) return;
    handleAddRule(conflict.newText, "manual");
    setConflict(null);
    setNewRuleText("");
  };

  // Combine smart rules and any legacy rules not already represented by smart rules
  const smartRuleTexts = new Set(rules.map((r) => r.text.toLowerCase()));
  const unmigratedLegacy = legacyRules.filter(
    (lr) => !smartRuleTexts.has(lr.toLowerCase())
  );

  const totalCount = rules.length + unmigratedLegacy.length;

  return (
    <div className="space-y-3 pt-2 border-t border-primary/20" data-testid="rules-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <SparklesIcon className="size-3.5 text-violet-500" />
          <Label className="text-xs font-semibold text-violet-700 dark:text-violet-400">
            Правила и адаптации ({totalCount})
          </Label>
        </div>
        <span className="text-[10px] text-muted-foreground">
          Вес · Источник · Срабатывания
        </span>
      </div>

      {/* Conflict Resolution Dialog */}
      {conflict && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2 animate-in fade-in duration-150">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <span className="font-semibold text-amber-700 dark:text-amber-300">
                Обнаружено противоречие правил
              </span>
              <p className="text-muted-foreground leading-snug">
                Новое правило «<span className="text-foreground font-medium">{conflict.newText}</span>»
                противоречит существующему правилу «<span className="text-foreground font-medium">{conflict.existing.text}</span>».
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-1.5 pt-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setConflict(null)}
            >
              Отмена
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={handleResolveConflictKeepBoth}
            >
              Оставить оба
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleResolveConflictReplace}
            >
              Заменить старое
            </Button>
          </div>
        </div>
      )}

      {/* Rules list */}
      <div className="space-y-1.5">
        {totalCount === 0 ? (
          <p className="text-[11px] text-muted-foreground italic py-1">Нет кастомных правил</p>
        ) : (
          <>
            {/* Smart Rules list with weights and hits */}
            {rules.map((rule) => {
              const src = rule.origin?.source || "manual";
              return (
                <div
                  key={rule.id}
                  className="flex items-center justify-between gap-2 text-xs p-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-foreground/90 transition-colors"
                >
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      data-testid="rule-source-badge"
                      className={cn(
                        "px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0",
                        src === "coach"
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          : src === "feedback"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-primary/15 text-primary"
                      )}
                    >
                      {src}
                    </span>
                    <span
                      data-testid="rule-weight-badge"
                      className="px-1.5 py-0.5 rounded bg-muted/60 text-[10px] font-mono text-muted-foreground"
                      title="Вес правила в системном промпте"
                    >
                      w:{rule.weight.toFixed(1)}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded bg-muted/40 text-[10px] text-muted-foreground"
                      title="Количество срабатываний"
                    >
                      {rule.hits} {rule.hits === 1 ? "хит" : "хитов"}
                    </span>
                  </div>

                  <span className="truncate flex-1 font-medium">{rule.text}</span>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={() => handleArchiveRule(rule.id)}
                      title={rule.archived ? "Разархивировать правило" : "Архивировать правило"}
                    >
                      <ShieldAlertIcon className="size-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteRule(rule.id)}
                      title="Удалить правило"
                    >
                      <Trash2Icon className="size-3" />
                    </Button>
                  </div>
                </div>
              );
            })}

            {/* Unmigrated legacy custom rules */}
            {unmigratedLegacy.map((r, i) => {
              const ruleSource = resolveRuleSource(r);
              return (
                <div
                  key={`legacy-${i}`}
                  className="flex items-center justify-between gap-1.5 text-xs p-1.5 rounded bg-violet-500/10 border border-violet-500/20 text-foreground/90"
                >
                  <span
                    data-testid="rule-source-badge"
                    className={cn(
                      "px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0",
                      ruleSource === "coach"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        : ruleSource === "feedback"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-primary/15 text-primary"
                    )}
                  >
                    {ruleSource}
                  </span>
                  <span className="truncate flex-1">{r}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => handleRemoveLegacyRule(i)}
                    title="Удалить правило"
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Add rule input */}
      <div className="flex items-center gap-2 pt-1">
        <Input
          value={newRuleText}
          onChange={(e) => setNewRuleText(e.target.value)}
          placeholder="Add custom rule (e.g. Always explain time complexity)..."
          className="h-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAttemptAdd();
          }}
        />
        <Button
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={handleAttemptAdd}
          disabled={!newRuleText.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  );
};
