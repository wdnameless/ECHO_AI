import React, { useState } from "react";
import {
  Button,
  Label,
  Input,
  Textarea,
} from "@/components";
import {
  SparklesIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  FileCodeIcon,
  RotateCcwIcon,
  SaveIcon,
  CheckCircle2Icon,
  Trash2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  UserFact,
  FeedbackEntry,
  UserStylePreference,
} from "@/lib/storage/user-facts";
import { SelfLearningToggle } from "@/components/SelfLearningToggle";
import { RulesPanel } from "./RulesPanel";

export interface MemoryPanelsProps {
  facts: UserFact[];
  onAddFact: (text: string) => void;
  onRemoveFact: (id: string) => void;
  stylePrefs: UserStylePreference;
  onRemoveFavoritePattern: (index: number) => void;
  onRemoveAvoidPattern: (index: number) => void;
  feedbackLogs: FeedbackEntry[];
  markdownText: string;
  onSaveMarkdown: (text: string) => void;
  onResetMarkdown: () => void;
  onResetLearning: () => void;
}

export const MemoryPanels: React.FC<MemoryPanelsProps> = ({
  facts,
  onAddFact,
  onRemoveFact,
  stylePrefs,
  onRemoveFavoritePattern,
  onRemoveAvoidPattern,
  feedbackLogs,
  markdownText,
  onSaveMarkdown,
  onResetMarkdown,
  onResetLearning,
}) => {
  const [showMarkdownEditor, setShowMarkdownEditor] = useState(false);
  const [localMarkdown, setLocalMarkdown] = useState(markdownText);
  const [markdownSaved, setMarkdownSaved] = useState(false);
  const [newFactText, setNewFactText] = useState("");

  const likesCount = feedbackLogs.filter((l) => l.rating === "like").length;
  const dislikesCount = feedbackLogs.filter((l) => l.rating === "dislike").length;

  const handleSaveMd = () => {
    onSaveMarkdown(localMarkdown);
    setMarkdownSaved(true);
    setTimeout(() => setMarkdownSaved(false), 2000);
  };

  const handleResetMd = () => {
    onResetMarkdown();
    setLocalMarkdown(markdownText);
  };

  const handleAddFactSubmit = () => {
    const text = newFactText.trim();
    if (!text) return;
    onAddFact(text);
    setNewFactText("");
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-4 animate-in fade-in duration-200" data-testid="memory-panels">
      <SelfLearningToggle variant="full" />

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 pb-2">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-primary shrink-0" />
          <div>
            <span className="text-sm font-semibold">Self-Evolution Knowledge Base & USER.md</span>
            <p className="text-xs text-muted-foreground">
              AI automatically extracts your facts, stack, tone, and evolves rules from your 👍 / 👎 ratings
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full font-medium">
            <ThumbsUpIcon className="size-3" /> {likesCount}
          </span>
          <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full font-medium">
            <ThumbsDownIcon className="size-3" /> {dislikesCount}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={() => {
              setLocalMarkdown(markdownText);
              setShowMarkdownEditor((prev) => !prev);
            }}
          >
            <FileCodeIcon className="size-3.5 text-primary" />
            {showMarkdownEditor ? "Visual Mode" : "USER.md Editor"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground hover:text-destructive gap-1"
            onClick={onResetLearning}
            title="Reset all learned memory and feedback"
          >
            <RotateCcwIcon className="size-3" />
            Reset
          </Button>
        </div>
      </div>

      {/* RAW USER.MD MARKDOWN EDITOR VIEW */}
      {showMarkdownEditor ? (
        <div className="space-y-2 bg-background/80 p-3 rounded-lg border border-primary/30">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
              <FileCodeIcon className="size-3.5" /> USER.md Context Profile
            </Label>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleResetMd}>
                Restore Auto-Template
              </Button>
              <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSaveMd}>
                <SaveIcon className="size-3" />
                Save USER.md
              </Button>
              {markdownSaved && (
                <span className="flex items-center gap-1 text-xs text-emerald-500 font-medium">
                  <CheckCircle2Icon className="size-3" /> Saved
                </span>
              )}
            </div>
          </div>
          <Textarea
            value={localMarkdown}
            onChange={(e) => setLocalMarkdown(e.target.value)}
            placeholder="# USER.md..."
            className="min-h-[220px] font-mono text-xs leading-relaxed"
          />
          <p className="text-[10px] text-muted-foreground">
            You can edit this raw markdown memory directly. The Self-Evolution profile will use this exact profile context for all answers.
          </p>
        </div>
      ) : (
        <>
          {/* User Known Facts List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Known Personal Facts & Experience ({facts.length})
              </Label>
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {facts.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg bg-background/80 border border-border/40 text-xs"
                >
                  <span className="flex-1 truncate">{f.fact}</span>
                  <span className="text-[10px] text-muted-foreground uppercase px-1 rounded bg-muted">
                    {f.category}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemoveFact(f.id)}
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Add Fact Manually */}
            <div className="flex items-center gap-2 pt-1">
              <Input
                value={newFactText}
                onChange={(e) => setNewFactText(e.target.value)}
                placeholder="Add custom fact (e.g. 8 years Go/Rust backend experience, specializes in high-load)..."
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddFactSubmit();
                }}
              />
              <Button size="sm" className="h-8 px-3 text-xs" onClick={handleAddFactSubmit} disabled={!newFactText.trim()}>
                Add
              </Button>
            </div>
          </div>

          {/* Evolved Style Patterns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-primary/20">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                ⭐ Favorite Patterns (Reinforced by 👍)
              </Label>
              <div className="space-y-1">
                {stylePrefs.favoritePatterns.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">Нет эталонов стиля</p>
                ) : (
                  stylePrefs.favoritePatterns.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-1 text-xs p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-foreground/90">
                      <span className="truncate flex-1">{p}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-4 w-4 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => onRemoveFavoritePattern(i)}
                      >
                        <Trash2Icon className="size-3" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-red-700 dark:text-red-400">
                🚫 Avoid Constraints (Learned from 👎)
              </Label>
              <div className="space-y-1">
                {stylePrefs.avoidPatterns.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">Нет ограничений</p>
                ) : (
                  stylePrefs.avoidPatterns.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-1 text-xs p-1.5 rounded bg-red-500/10 border border-red-500/20 text-foreground/90">
                      <span className="truncate flex-1">{p}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-4 w-4 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => onRemoveAvoidPattern(i)}
                      >
                        <Trash2Icon className="size-3" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Rules Panel */}
          <RulesPanel />

          {/* Feedback & Evolution Journal (Last 20) */}
          <div className="space-y-2 pt-3 border-t border-primary/20">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Журнал обучения (последние {Math.min(20, feedbackLogs.length)} событий)
              </Label>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {feedbackLogs.length === 0 ? (
                <div className="p-3 text-center text-xs text-muted-foreground rounded-lg bg-background/50 border border-border/30">
                  Журнал пуст. Здесь появятся последние 20 сигналов обучения (оценки ответов и ручные правки).
                </div>
              ) : (
                feedbackLogs.slice(0, 20).map((entry) => {
                  let badgeClass = "bg-red-500/10 text-red-600 dark:text-red-400";
                  let badgeLabel = `${entry.rating === "like" ? "👍 like" : "👎 dislike"} · feedback`;
                  if (entry.topic === "coach") {
                    badgeClass = "bg-amber-500/15 text-amber-700 dark:text-amber-300";
                    badgeLabel = "🎯 coach";
                  } else if (entry.topic === "manual") {
                    badgeClass = "bg-primary/10 text-primary";
                    badgeLabel = "✏️ manual";
                  } else if (entry.rating === "like") {
                    badgeClass = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
                  }
                  return (
                    <div
                      key={entry.id}
                      className="p-2 rounded-lg bg-background/80 border border-border/40 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-[10px]">
                        <div className="flex items-center gap-1">
                          <span
                            data-testid="journal-source-badge"
                            className={cn(
                              "px-1.5 py-0.5 rounded-full font-medium inline-flex items-center gap-1",
                              badgeClass
                            )}
                          >
                            {badgeLabel}
                          </span>
                        </div>
                        <span className="text-muted-foreground font-mono">
                          {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                      </div>
                      <div className="text-[11px] font-medium text-foreground truncate">
                        <span className="text-muted-foreground">Вопрос:</span> {entry.question}
                      </div>
                      <div className="text-[11px] text-muted-foreground line-clamp-2">
                        <span className="text-foreground/70">Ответ:</span> {entry.response}
                      </div>
                      {entry.reason && (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400">
                          <span>Причина:</span> {entry.reason}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
