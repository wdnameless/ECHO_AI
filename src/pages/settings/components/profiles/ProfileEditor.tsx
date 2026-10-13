import React, { useState, useMemo } from "react";
import {
  Button,
  Label,
  Input,
  Textarea,
  Switch,
} from "@/components";
import {
  PenLineIcon,
  RotateCcwIcon,
  Trash2Icon,
  DownloadIcon,
  UploadIcon,
  EyeIcon,
  Code2Icon,
  CopyIcon,
  CheckIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PromptProfile } from "@/lib/storage/prompt-profiles";
import { buildPreviewPrompt } from "@/lib/prompt-builder";
import { AVAILABLE_TOOLBAR_BUTTONS } from "../PromptProfilesSettings";

export interface ProfileEditorProps {
  profile: PromptProfile;
  isEditing: boolean;
  draft: PromptProfile | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDraftChange: (updater: (prev: PromptProfile) => PromptProfile) => void;
  onResetProfile: (id: string) => void;
  onDeleteProfile: (profile: PromptProfile) => void;
  onExportCurrent: () => void;
  onExportAll: () => void;
  onOpenImport: () => void;
}

export { buildPreviewPrompt };

export const ProfileEditor: React.FC<ProfileEditorProps> = ({
  profile,
  isEditing,
  draft,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDraftChange,
  onResetProfile,
  onDeleteProfile,
  onExportCurrent,
  onExportAll,
  onOpenImport,
}) => {
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");
  const [copied, setCopied] = useState(false);

  const effectiveProfile = isEditing && draft ? draft : profile;

  const previewPrompt = useMemo(() => {
    return buildPreviewPrompt(effectiveProfile);
  }, [effectiveProfile]);

  const handleCopyPreview = () => {
    navigator.clipboard.writeText(previewPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-border/50 bg-muted/10 p-4 space-y-4">
      {/* Editor Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
        <div className="flex items-center gap-2">
          <PenLineIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Editing: {profile.name}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Tab Switcher: Editor / Prompt Preview */}
          <div className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("edit")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors font-medium",
                activeTab === "edit"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Code2Icon className="size-3.5" />
              Редактор
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("preview")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors font-medium",
                activeTab === "preview"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <EyeIcon className="size-3.5" />
              Превью промпта
            </button>
          </div>

          {profile.isBuiltin ? (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 h-7 text-xs"
              onClick={() => onResetProfile(profile.id)}
              title="Вернуть встроенный промпт к заводскому тексту"
            >
              <RotateCcwIcon className="size-3.5" />
              Reset to Default
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 gap-1.5 h-7 text-xs"
              onClick={() => onDeleteProfile(profile)}
              title="Удалить профиль"
            >
              <Trash2Icon className="size-3.5" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Mode View: Edit or Preview */}
      {activeTab === "preview" ? (
        <div className="space-y-3" data-testid="profile-prompt-preview">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <EyeIcon className="size-3.5" /> Итоговый системный промпт
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Так системный промпт выглядит для языковой модели со всеми инструкциями сценария
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-muted-foreground">
                {previewPrompt.length} симв. · {previewPrompt.split(/\s+/).filter(Boolean).length} слов
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={handleCopyPreview}
              >
                {copied ? <CheckIcon className="size-3 text-emerald-500" /> : <CopyIcon className="size-3" />}
                {copied ? "Скопировано" : "Копировать"}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-background/90 p-3.5 font-mono text-xs leading-relaxed max-h-[360px] overflow-y-auto whitespace-pre-wrap select-text">
            {previewPrompt}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* System prompt */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">System Prompt</Label>
            <Textarea
              value={effectiveProfile.systemPrompt}
              onChange={(e) =>
                onDraftChange((d) => ({ ...d, systemPrompt: e.target.value }))
              }
              disabled={!isEditing}
              placeholder="How should the AI behave in this profile?"
              className="min-h-[140px] text-xs leading-relaxed font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              Tip: edit and save, then the floating window instantly uses this prompt.
            </p>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/50 p-2.5">
              <div>
                <Label className="text-xs font-medium">Humanizer</Label>
                <p className="text-[10px] text-muted-foreground">Human-like answers</p>
              </div>
              <Switch
                checked={effectiveProfile.humanizerEnabled}
                onCheckedChange={(v) =>
                  onDraftChange((d) => ({ ...d, humanizerEnabled: v }))
                }
                disabled={!isEditing}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/50 p-2.5">
              <div>
                <Label className="text-xs font-medium">Interview Mode</Label>
                <p className="text-[10px] text-muted-foreground">Candidate answers style</p>
              </div>
              <Switch
                checked={effectiveProfile.interviewMode}
                onCheckedChange={(v) =>
                  onDraftChange((d) => ({ ...d, interviewMode: v }))
                }
                disabled={!isEditing}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/50 p-2.5">
              <div>
                <Label className="text-xs font-medium">Use Resume</Label>
                <p className="text-[10px] text-muted-foreground">Ground answers in resume</p>
              </div>
              <Switch
                checked={effectiveProfile.ragResumeEnabled}
                onCheckedChange={(v) =>
                  onDraftChange((d) => ({ ...d, ragResumeEnabled: v }))
                }
                disabled={!isEditing}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/50 p-2.5">
              <div>
                <Label className="text-xs font-medium">Use Job Description</Label>
                <p className="text-[10px] text-muted-foreground">Ground answers in vacancy</p>
              </div>
              <Switch
                checked={effectiveProfile.ragJobEnabled}
                onCheckedChange={(v) =>
                  onDraftChange((d) => ({ ...d, ragJobEnabled: v }))
                }
                disabled={!isEditing}
              />
            </div>
          </div>

          {/* Custom style */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Personal Style (optional)</Label>
            <Input
              value={effectiveProfile.customStyle}
              onChange={(e) =>
                onDraftChange((d) => ({ ...d, customStyle: e.target.value }))
              }
              disabled={!isEditing}
              placeholder="e.g. speak short, use metaphors, mention numbers..."
              className="h-9 text-xs"
            />
          </div>

          {/* Timing, Length & Monologue Config */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1.5 rounded-lg border border-border/40 bg-background/50 p-2.5">
              <Label className="text-xs font-medium">Silence Flush Gap (мс)</Label>
              <Input
                type="number"
                value={effectiveProfile.flushGapMs ?? 450}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  onDraftChange((d) => ({
                    ...d,
                    flushGapMs: isNaN(val) ? 450 : val,
                  }));
                }}
                disabled={!isEditing}
                className="h-8 text-xs font-mono"
                placeholder="450 (быстрый) / 1500 (разговор)"
              />
              <p className="text-[10px] text-muted-foreground">
                Пауза тишины перед отправкой (450 мс для собеседований, 1500 мс для бесед)
              </p>
            </div>

            <div className="space-y-1.5 rounded-lg border border-border/40 bg-background/50 p-2.5">
              <Label className="text-xs font-medium">Длина ответа по умолчанию</Label>
              <div className="flex gap-1 pt-1">
                {(["auto", "short", "long"] as const).map((len) => {
                  const cur = effectiveProfile.defaultLength ?? "auto";
                  const isSelected = cur === len;
                  return (
                    <button
                      key={len}
                      type="button"
                      disabled={!isEditing}
                      onClick={() =>
                        onDraftChange((d) => ({ ...d, defaultLength: len }))
                      }
                      className={cn(
                        "flex-1 px-2 py-1 text-xs rounded border transition-colors font-medium",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border/60 hover:bg-muted text-muted-foreground"
                      )}
                    >
                      {len === "auto" ? "Авто" : len === "short" ? "Кратко" : "Подробно"}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Краткость ответов модели в оверлее
              </p>
            </div>

            <div className="space-y-1.5 rounded-lg border border-border/40 bg-background/50 p-2.5">
              <Label className="text-xs font-medium">Режим монолога</Label>
              <div className="flex gap-1 pt-1">
                {(["auto", "semi", "manual"] as const).map((mode) => {
                  const cur = effectiveProfile.monologue?.mode ?? "auto";
                  const isSelected = cur === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      disabled={!isEditing}
                      onClick={() =>
                        onDraftChange((d) => ({
                          ...d,
                          monologue: {
                            mode,
                            maxWindow: d.monologue?.maxWindow ?? 12000,
                          },
                        }))
                      }
                      className={cn(
                        "flex-1 px-2 py-1 text-xs rounded border transition-colors font-medium",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border/60 hover:bg-muted text-muted-foreground"
                      )}
                    >
                      {mode === "auto" ? "Авто" : mode === "semi" ? "Полуавто" : "Вручную"}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Авто (по тишине) / Полуавто (подтверждение) / Вручную (кнопка)
              </p>
            </div>

            <div className="space-y-1.5 rounded-lg border border-border/40 bg-background/50 p-2.5">
              <Label className="text-xs font-medium">Окно накопления монолога (мс)</Label>
              <Input
                type="number"
                value={effectiveProfile.monologue?.maxWindow ?? 12000}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  onDraftChange((d) => ({
                    ...d,
                    monologue: {
                      mode: d.monologue?.mode ?? "auto",
                      maxWindow: isNaN(val) ? 12000 : val,
                    },
                  }));
                }}
                disabled={!isEditing}
                className="h-8 text-xs font-mono"
                placeholder="12000"
              />
              <p className="text-[10px] text-muted-foreground">
                Максимальное окно накопления нон-стоп спича перед отправкой
              </p>
            </div>
          </div>

          {/* Visible Buttons in Toolbar */}
          <div className="space-y-2 rounded-lg border border-border/40 bg-background/50 p-2.5">
            <Label className="text-xs font-medium">Видимые кнопки в оверлее</Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {AVAILABLE_TOOLBAR_BUTTONS.map((btn) => {
                const currentButtons = effectiveProfile.visibleButtons ?? [];
                const isVisible = currentButtons.includes(btn.id);

                return (
                  <button
                    key={btn.id}
                    type="button"
                    disabled={!isEditing}
                    onClick={() => {
                      if (!isEditing) return;
                      onDraftChange((d) => {
                        const cur = d.visibleButtons ?? [];
                        const next = cur.includes(btn.id)
                          ? cur.filter((id) => id !== btn.id)
                          : [...cur, btn.id];
                        return { ...d, visibleButtons: next };
                      });
                    }}
                    className={cn(
                      "flex items-center justify-between p-1.5 rounded border text-left text-xs transition-colors",
                      isVisible
                        ? "bg-primary/10 border-primary text-foreground font-medium"
                        : "border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40",
                      !isEditing && "cursor-default opacity-80"
                    )}
                  >
                    <span className="truncate">{btn.label}</span>
                    <span
                      className={cn(
                        "size-2 rounded-full shrink-0 ml-1",
                        isVisible ? "bg-primary" : "bg-muted-foreground/30"
                      )}
                    />
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Тулбар в оверлее отображает только кнопки, включённые для активного сценария
            </p>
          </div>

          {/* Edit / Save Action Bar */}
          <div className="flex flex-wrap gap-2 pt-1">
            {isEditing ? (
              <>
                <Button size="sm" onClick={onSaveEdit}>
                  Save profile
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onCancelEdit}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={onStartEdit}>
                  <PenLineIcon className="size-3.5 mr-1" />
                  Edit profile
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onExportCurrent}
                  title="Скачать текущий профиль как JSON"
                >
                  <DownloadIcon className="size-3.5 mr-1" />
                  Экспорт
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onExportAll}
                  title="Скачать все профили как JSON"
                >
                  <DownloadIcon className="size-3.5 mr-1" />
                  Экспорт всех
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onOpenImport}
                  title="Импортировать профили из JSON"
                >
                  <UploadIcon className="size-3.5 mr-1" />
                  Импорт
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
