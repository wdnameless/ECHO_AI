import React, { useState } from "react";
import {
  Button,
  Label,
  Input,
  Textarea,
  Switch,
} from "@/components";
import {
  SparklesIcon,
  XIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  CheckIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PromptProfile,
  ProfileResponseLength,
  ToolbarButtonId,
} from "@/lib/storage/prompt-profiles";
import { AVAILABLE_TOOLBAR_BUTTONS } from "../PromptProfilesSettings";

export interface ProfileWizardProps {
  open: boolean;
  onClose: () => void;
  onCreate: (profile: Omit<PromptProfile, "id">) => void;
  initialPrompt?: string;
}

export const ProfileWizard: React.FC<ProfileWizardProps> = ({
  open,
  onClose,
  onCreate,
  initialPrompt = "",
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Info
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Step 2: Prompt & Style
  const [systemPrompt, setSystemPrompt] = useState(initialPrompt);
  const [customStyle, setCustomStyle] = useState("");

  // Step 3: Behavior & Toolbar
  const [humanizerEnabled, setHumanizerEnabled] = useState(true);
  const [interviewMode, setInterviewMode] = useState(false);
  const [ragResumeEnabled, setRagResumeEnabled] = useState(false);
  const [ragJobEnabled, setRagJobEnabled] = useState(false);
  const [flushGapMs, setFlushGapMs] = useState(1000);
  const [defaultLength, setDefaultLength] = useState<ProfileResponseLength>("auto");
  const [monologueMode, setMonologueMode] = useState<"auto" | "semi" | "manual">("auto");
  const [monologueMaxWindow, setMonologueMaxWindow] = useState(12000);
  const [visibleButtons, setVisibleButtons] = useState<ToolbarButtonId[]>([
    "length",
    "thought",
    "answer",
    "screenshot",
    "audio_settings",
    "settings",
    "new_chat",
  ]);

  if (!open) return null;

  const handleNext = () => {
    if (step === 1 && !name.trim()) return;
    if (step < 3) setStep((s) => (s + 1) as 2 | 3);
  };

  const handleBack = () => {
    if (step > 1) setStep((s) => (s - 1) as 1 | 2);
  };

  const handleFinish = () => {
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      description: description.trim() || "Custom prompt profile",
      systemPrompt: systemPrompt.trim(),
      humanizerEnabled,
      interviewMode,
      customStyle: customStyle.trim(),
      ragResumeEnabled,
      ragJobEnabled,
      flushGapMs,
      defaultLength,
      visibleButtons,
      monologue: {
        mode: monologueMode,
        maxWindow: monologueMaxWindow,
      },
    });
    // Reset wizard
    setStep(1);
    setName("");
    setDescription("");
    setSystemPrompt(initialPrompt);
    setCustomStyle("");
    onClose();
  };

  const stepsHeader = [
    { num: 1, label: "Название" },
    { num: 2, label: "Промпт" },
    { num: 3, label: "Настройки" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-xl rounded-xl border border-border bg-background p-6 shadow-xl space-y-5 animate-in zoom-in-95 duration-150">
        {/* Wizard Header */}
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <SparklesIcon className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Мастер создания профиля</h3>
              <p className="text-xs text-muted-foreground">Шаг {step} из 3</p>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Step Indicator */}
        <div className="grid grid-cols-3 gap-2">
          {stepsHeader.map((s) => {
            const isCompleted = s.num < step;
            const isCurrent = s.num === step;
            return (
              <div
                key={s.num}
                className={cn(
                  "flex items-center gap-2 p-2 rounded-lg border text-xs transition-colors",
                  isCurrent
                    ? "border-primary bg-primary/5 text-primary font-medium"
                    : isCompleted
                    ? "border-border/60 bg-muted/40 text-muted-foreground"
                    : "border-border/40 text-muted-foreground/60 opacity-60"
                )}
              >
                <div
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : isCompleted
                      ? "bg-muted-foreground/20 text-muted-foreground"
                      : "bg-muted text-muted-foreground/50"
                  )}
                >
                  {isCompleted ? <CheckIcon className="size-3" /> : s.num}
                </div>
                <span className="truncate">{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Step 1: Name and Description */}
        {step === 1 && (
          <div className="space-y-3.5 py-1" data-testid="wizard-step-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Название профиля <span className="text-destructive">*</span>
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Profile name (e.g. System Design, HR Round...)"
                className="h-9 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) handleNext();
                }}
              />
              <p className="text-[10px] text-muted-foreground">
                Краткое понятное имя, отображаемое на карточке и в оверлее
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Описание</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Краткое описание назначения сценария"
                className="h-9 text-xs"
              />
            </div>
          </div>
        )}

        {/* Step 2: Prompt & Style */}
        {step === 2 && (
          <div className="space-y-3.5 py-1" data-testid="wizard-step-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Системный промпт</Label>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="How should the AI behave in this profile?"
                className="min-h-[140px] text-xs font-mono leading-relaxed"
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground">
                Главная инструкция для ИИ, определяющая роль и правила ответов
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Индивидуальный стиль (необязательно)</Label>
              <Input
                value={customStyle}
                onChange={(e) => setCustomStyle(e.target.value)}
                placeholder="Например: отвечать тезисно, упоминать архитектурные метрики..."
                className="h-8 text-xs"
              />
            </div>
          </div>
        )}

        {/* Step 3: Settings & Buttons */}
        {step === 3 && (
          <div className="space-y-3.5 py-1 max-h-[360px] overflow-y-auto pr-1" data-testid="wizard-step-3">
            {/* Toggles */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 p-2.5">
                <div>
                  <Label className="text-xs font-medium">Хуманизатор</Label>
                  <p className="text-[10px] text-muted-foreground">Естественная речь</p>
                </div>
                <Switch
                  checked={humanizerEnabled}
                  onCheckedChange={setHumanizerEnabled}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 p-2.5">
                <div>
                  <Label className="text-xs font-medium">Interview Mode</Label>
                  <p className="text-[10px] text-muted-foreground">Стиль кандидата</p>
                </div>
                <Switch
                  checked={interviewMode}
                  onCheckedChange={setInterviewMode}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 p-2.5">
                <div>
                  <Label className="text-xs font-medium">Use Resume</Label>
                  <p className="text-[10px] text-muted-foreground">Контекст резюме</p>
                </div>
                <Switch
                  checked={ragResumeEnabled}
                  onCheckedChange={setRagResumeEnabled}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 p-2.5">
                <div>
                  <Label className="text-xs font-medium">Use Job Description</Label>
                  <p className="text-[10px] text-muted-foreground">Контекст вакансии</p>
                </div>
                <Switch
                  checked={ragJobEnabled}
                  onCheckedChange={setRagJobEnabled}
                />
              </div>
            </div>

            {/* Timings & Length */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1 rounded-lg border border-border/50 bg-muted/20 p-2.5">
                <Label className="text-xs font-medium">Silence Flush Gap (мс)</Label>
                <Input
                  type="number"
                  value={flushGapMs}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setFlushGapMs(isNaN(val) ? 450 : val);
                  }}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1 rounded-lg border border-border/50 bg-muted/20 p-2.5">
                <Label className="text-xs font-medium">Длина ответа</Label>
                <div className="flex gap-1 pt-0.5">
                  {(["auto", "short", "long"] as const).map((len) => (
                    <button
                      key={len}
                      type="button"
                      onClick={() => setDefaultLength(len)}
                      className={cn(
                        "flex-1 px-2 py-1 text-xs rounded border transition-colors font-medium",
                        defaultLength === len
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border/60 hover:bg-muted text-muted-foreground"
                      )}
                    >
                      {len === "auto" ? "Авто" : len === "short" ? "Кратко" : "Подробно"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Monologue Configuration */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1 rounded-lg border border-border/50 bg-muted/20 p-2.5">
                <Label className="text-xs font-medium">Режим монолога</Label>
                <div className="flex gap-1 pt-0.5">
                  {(["auto", "semi", "manual"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setMonologueMode(mode)}
                      className={cn(
                        "flex-1 px-2 py-1 text-xs rounded border transition-colors font-medium",
                        monologueMode === mode
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border/60 hover:bg-muted text-muted-foreground"
                      )}
                    >
                      {mode === "auto" ? "Авто" : mode === "semi" ? "Полуавто" : "Вручную"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1 rounded-lg border border-border/50 bg-muted/20 p-2.5">
                <Label className="text-xs font-medium">Окно монолога (мс)</Label>
                <Input
                  type="number"
                  value={monologueMaxWindow}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setMonologueMaxWindow(isNaN(val) ? 12000 : val);
                  }}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
            {/* Visible buttons */}
            <div className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-2.5">
              <Label className="text-xs font-medium">Кнопки оверлея</Label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {AVAILABLE_TOOLBAR_BUTTONS.map((btn) => {
                  const isVisible = visibleButtons.includes(btn.id);
                  return (
                    <button
                      key={btn.id}
                      type="button"
                      onClick={() => {
                        setVisibleButtons((cur) =>
                          cur.includes(btn.id)
                            ? cur.filter((id) => id !== btn.id)
                            : [...cur, btn.id]
                        );
                      }}
                      className={cn(
                        "flex items-center justify-between p-1.5 rounded border text-left text-xs transition-colors",
                        isVisible
                          ? "bg-primary/10 border-primary text-foreground font-medium"
                          : "border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40"
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
            </div>
          </div>
        )}

        {/* Wizard Footer */}
        <div className="flex items-center justify-between border-t border-border/60 pt-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
          >
            Отмена
          </Button>

          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={handleBack}
              >
                <ChevronLeftIcon className="size-3.5" />
                Назад
              </Button>
            )}

            {step < 3 ? (
              <Button
                size="sm"
                className="gap-1"
                onClick={handleNext}
                disabled={step === 1 && !name.trim()}
              >
                Далее
                <ChevronRightIcon className="size-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleFinish}
                disabled={!name.trim()}
              >
                <CheckIcon className="size-3.5" />
                Создать профиль
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
