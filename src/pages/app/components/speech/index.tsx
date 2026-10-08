import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Button, ScrollArea } from "@/components";
import { useAppVersion } from "@/lib/version";
import { PermissionFlow } from "./PermissionFlow";
import {
  AlertCircleIcon,
  CameraIcon,
  XIcon,
  PlusIcon,
  LoaderIcon,
  Settings2Icon,
  SettingsIcon,
  MicIcon,
  SparklesIcon,
  CodeIcon,
  CheckIcon,
} from "lucide-react";
import { ModeSwitcher } from "./ModeSwitcher";
import { ResultsSection } from "./ResultsSection";
import { SettingsPanel } from "./SettingsPanel";
import { RecordingPanel } from "./RecordingPanel";
import {
  useSystemAudio,
  MIN_PANEL_HEIGHT,
  rememberPanelHeight,
} from "@/hooks";
import { cn } from "@/lib/utils";
import { detectTextLanguage } from "@/lib/transcript-stabilizer";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "@/contexts";
import { canUseFeature, isDevBuild } from "@/lib/entitlements";
import { getAnswerMode, setAnswerMode, type AnswerMode } from "@/lib/answer-mode";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getAIProviderVariables } from "@/lib/storage/ai-providers";
import { STORAGE_KEYS } from "@/config/constants";
import { resolveProviderModel } from "@/lib/functions/ai-response.function";
import { getActiveProfile, type PromptProfile } from "@/lib/storage/prompt-profiles";

// Contract from feat/slice1-profiles (commit d9b0423)
export type ToolbarButtonId =
  | "length"
  | "thought"
  | "livecode"
  | "answer"
  | "code_plan"
  | "code_full"
  | "code_screen"
  | "screenshot"
  | "audio_settings"
  | "settings"
  | "new_chat"
  | "monologue_send";

export const SystemAudio = (props: ReturnType<typeof useSystemAudio>) => {
  const {
    askAIForTranscript,
    activeFiller,
    pendingUtteranceId,
    capturing,
    error,
    isProcessing,
    isAIProcessing,
    myLastTranscription,
    theirLastTranscription,
    lastAIResponse,
    conversation,
    recordingProgress,
    vadConfig,
    useSystemPrompt,
    contextContent,
    isContinuousMode,
    setIsContinuousMode,
    isRecordingInContinuousMode,
    setupRequired,
    setIsPopoverOpen,
    setUseSystemPrompt,
    setContextContent,
    updateVadConfiguration,
    startCapture,
    startContinuousRecording,
    startNewConversation,
    setPendingScreenshot,
    resizeWindow,
    autoAskMode = "auto",
    setAutoAskMode,
    answerLastInterviewerUtterance,
    answerCodeForLastUtterance,
    speechModelLang,
    speechModelSwitching,
    onSpeechModelSwitch,
    answerLengthOverride,
    onAnswerLengthOverride,
    warmupState,
    warmupVisible,
    onWarmup,
  } = props;
  const isVadMode = !isContinuousMode;
  const handleModeChange = (vadEnabled: boolean) => {
    if (setIsContinuousMode) {
      setIsContinuousMode(!vadEnabled);
    }
  };


  const [answerMode, setAnswerModeState] = useState<AnswerMode>(() => getAnswerMode());

  useEffect(() => {
    const onModeChange = () => setAnswerModeState(getAnswerMode());
    window.addEventListener("answer-mode-changed", onModeChange);
    window.addEventListener("storage", onModeChange);
    return () => {
      window.removeEventListener("answer-mode-changed", onModeChange);
      window.removeEventListener("storage", onModeChange);
    };
  }, []);

  const handleToggleAnswerMode = (target: "thought" | "livecode") => {
    const next = answerMode === target ? "interview" : target;
    setAnswerMode(next);
    setAnswerModeState(next);
  };

  const [conversationMode, setConversationMode] = useState(false);
  const appVersion = useAppVersion();
  const {
    hasActiveLicense,
    supportsImages,
    promptProfiles,
    activeProfileId,
    selectedAIProvider,
    allAiProviders,
    onSetSelectedAIProvider: contextOnSetSelectedAIProvider,
  } = useApp();

  const [localProfile, setLocalProfile] = useState<PromptProfile>(() => getActiveProfile());

  useEffect(() => {
    const onProfileChange = () => setLocalProfile(getActiveProfile());
    window.addEventListener("prompt-profile-changed", onProfileChange);
    window.addEventListener("storage", onProfileChange);
    return () => {
      window.removeEventListener("prompt-profile-changed", onProfileChange);
      window.removeEventListener("storage", onProfileChange);
    };
  }, []);

  const activeProfile = promptProfiles?.find((p) => p.id === activeProfileId) || localProfile;
  const visibleButtons =
    activeProfile && "visibleButtons" in activeProfile && Array.isArray(activeProfile.visibleButtons)
      ? activeProfile.visibleButtons
      : undefined;

  const isButtonVisible = (id: ToolbarButtonId): boolean => {
    if (!visibleButtons) return true;
    return visibleButtons.includes(id);
  };

  const effectiveSetSelectedAIProvider =
    props.onSetSelectedAIProvider || contextOnSetSelectedAIProvider;
  const [syncedProviderId, setSyncedProviderId] = useState<string | null>(null);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.SELECTED_AI_PROVIDER && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed?.provider) {
            setSyncedProviderId(parsed.provider);
            if (effectiveSetSelectedAIProvider) {
              effectiveSetSelectedAIProvider({
                provider: parsed.provider,
                variables: parsed.variables || getAIProviderVariables(parsed.provider),
              });
            }
          }
        } catch {}
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [effectiveSetSelectedAIProvider]);

  const effectiveProviderId =
    syncedProviderId || props.activeProviderId || selectedAIProvider?.provider || "";
  const effectiveProvider = allAiProviders?.find((p) => p.id === effectiveProviderId);
  const effectiveModel = resolveProviderModel(
    effectiveProvider || allAiProviders?.find((p) => p.id === selectedAIProvider?.provider),
    selectedAIProvider?.provider === effectiveProviderId
      ? selectedAIProvider
      : { provider: effectiveProviderId, variables: getAIProviderVariables(effectiveProviderId) }
  );

  const handleSelectProvider = (providerId: string) => {
    const vars = getAIProviderVariables(providerId);
    setSyncedProviderId(providerId);
    if (effectiveSetSelectedAIProvider) {
      effectiveSetSelectedAIProvider({ provider: providerId, variables: vars });
    }
  };

  const [screenshotImage, setScreenshotImage] = useState<string | null>(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const screenshotAllowed = canUseFeature("screenshot", {
    isDevBuild: isDevBuild(),
    hasLicense: hasActiveLicense,
  });

  const hasInterviewerUtterance = Boolean(theirLastTranscription?.trim());
  const handleRemoveScreenshot = () => {
    setScreenshotImage(null);
    setPendingScreenshot(null);
  };

  const handleCaptureScreenshot = async () => {
    try {
      setIsCapturingScreenshot(true);

      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac")) {
        const {
          checkScreenRecordingPermission,
          requestScreenRecordingPermission,
        } = await import("tauri-plugin-macos-permissions-api");

        const hasPermission = await checkScreenRecordingPermission();
        if (!hasPermission) {
          await requestScreenRecordingPermission();
          setIsCapturingScreenshot(false);
          return;
        }
      }

      // Capture screenshot
      const base64 = await invoke<string>("capture_to_base64");
      setScreenshotImage(base64);
      setPendingScreenshot(base64);
    } catch (err) {
      console.error("Failed to capture screenshot:", err);
    } finally {
      setIsCapturingScreenshot(false);
    }
  };

  /*
   * The copilot panel is docked under the top bar and fills the rest of the window.
   * It is portalled straight into `body` and positioned from `--bar-chrome` alone,
   * so its geometry does not depend on the bar's insides, on a Radix wrapper's
   * transform, or on its own measured height.
   */
  const panel = (capturing || setupRequired || error) && (
    <div
      data-panel-docked="true"
      data-no-drag="true"
      className="panel-docked z-50 select-none overflow-hidden rounded-xl border border-input/50 bg-background shadow-lg"
    >
          <div className="flex flex-col h-full max-w-full min-w-0 overflow-hidden">
            {/* Header - Top Control Toolbar (All actions consolidated at top!) */}
            <div className="flex-shrink-0 p-2.5 border-b border-border/50 bg-muted/10">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0 w-full">
                {/* Left: Mode Switcher & VAD */}
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
                  {!setupRequired && (
                    <ModeSwitcher
                      isVadMode={isVadMode}
                      onModeChange={handleModeChange}
                      disabled={
                        isRecordingInContinuousMode ||
                        isProcessing ||
                        isAIProcessing
                      }
                    />
                  )}

                  {!setupRequired && (
                    <>
                      {/* Режим ответа: Авто / Вручную */}
                      <div
                        className="flex items-center bg-muted rounded-md p-0.5 gap-0.5 shrink-0"
                        title="Режим ответа: Авто (по тишине 1 сек) или Вручную (по кнопке «Ответить»)"
                      >
                        <button
                          type="button"
                          onClick={() => setAutoAskMode?.("auto")}
                          className={cn(
                            "px-2 py-1 text-[11px] font-medium rounded transition-all",
                            autoAskMode === "auto"
                              ? "bg-background shadow-sm text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          Авто
                        </button>
                        <button
                          type="button"
                          onClick={() => setAutoAskMode?.("manual")}
                          className={cn(
                            "px-2 py-1 text-[11px] font-medium rounded transition-all",
                            autoAskMode === "manual"
                              ? "bg-background shadow-sm text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          Вручную
                        </button>
                      </div>

                      {/* RU/EN streaming model (R01). Model switch, not language pin. */}
                      <div
                        className="flex items-center bg-muted rounded-md p-0.5 gap-0.5 shrink-0"
                        title="Модель распознавания: RU — Parakeet TDT (русский, batch), EN — Parakeet Unified streaming (английский, Q4). Переключает модель движка (Ctrl+Shift+L)."
                      >
                        <button
                          type="button"
                          onClick={() => onSpeechModelSwitch?.("ru")}
                          disabled={speechModelSwitching}
                          className={cn(
                            "px-2 py-1 text-[11px] font-medium rounded transition-all",
                            speechModelLang === "ru"
                              ? "bg-background shadow-sm text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          RU
                        </button>
                        <button
                          type="button"
                          onClick={() => onSpeechModelSwitch?.("en")}
                          disabled={speechModelSwitching}
                          className={cn(
                            "px-2 py-1 text-[11px] font-medium rounded transition-all",
                            speechModelLang === "en"
                              ? "bg-background shadow-sm text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          EN
                        </button>
                      </div>
                      {/* Язык последней реплики vs активная модель (P2): мягкое
                          предупреждение, не авто-переключение. Детект по скрипту
                          (detectTextLanguage): смешанная строка решает большинством. */}
                      {(() => {
                        const lastText = (theirLastTranscription || "").trim();
                        if (!lastText || lastText.length < 8) return null;
                        const spoken = detectTextLanguage(lastText);
                        if (spoken === speechModelLang) return null;
                        const want = spoken === "ru" ? "RU" : "EN";
                        return (
                          <button
                            type="button"
                            onClick={() => onSpeechModelSwitch?.(spoken)}
                            disabled={speechModelSwitching}
                            className="px-2 py-1 text-[11px] font-medium rounded transition-all bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40 hover:bg-amber-500/25 shrink-0"
                            title={`Собеседник говорит на ${want}, а модель стоит ${speechModelLang.toUpperCase()}. Клик — переключить модель (движок рестартует).`}
                          >
                            {want}?
                          </button>
                        );
                      })()}
                      {/* Прогреть перед собесом (P0): движок+модель+провайдер+RAG до первого вопроса. */}
                      {warmupVisible && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onWarmup?.()}
                          disabled={warmupState === "running"}
                          className="h-6 text-[11px] font-medium gap-1 px-2 shrink-0 text-muted-foreground hover:text-foreground"
                          title="Прогреть: движок, модель, провайдер, RAG — первый вопрос не ждёт холодного старта"
                        >
                          {warmupState === "running" ? (
                            <>
                              <LoaderIcon className="w-3 h-3 animate-spin" />
                              Готовится
                            </>
                          ) : (
                            "Прогреть"
                          )}
                        </Button>
                      )}

                      {/* Answer length override (R03): auto + manual. */}
                      {isButtonVisible("length") && (
                        <div
                          className="flex items-center bg-muted rounded-md p-0.5 gap-0.5 shrink-0"
                          title="Длина ответа: Авто (по вопросу), Кратко (35-55 слов), Подробно (~140 слов). Префиксы кратко:/подробно: в вопросе тоже работают."
                        >
                          {["auto","short","long"].map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => onAnswerLengthOverride?.(m as "auto" | "short" | "long")}
                              className={cn(
                                "px-2 py-1 text-[11px] font-medium rounded transition-all",
                                answerLengthOverride === m
                                  ? "bg-background shadow-sm text-foreground"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              {m === "auto" ? "Авто" : m === "short" ? "Кратко" : "Подробно"}
                            </button>
                          ))}
                        </div>
                      )}
                      {/* Режимы ответа: Ход мыслей / Лайвкодинг (R01/R02) */}
                      {(isButtonVisible("thought") || isButtonVisible("livecode")) && (
                        <div
                          className="flex items-center bg-muted rounded-md p-0.5 gap-0.5 shrink-0"
                          title="Режим ответа: Ход мыслей (компактное обоснование) или Лайвкодинг (диктуемый код)"
                        >
                          {isButtonVisible("thought") && (
                            <button
                              type="button"
                              onClick={() => handleToggleAnswerMode("thought")}
                              className={cn(
                                "px-2 py-1 text-[11px] font-medium rounded transition-all flex items-center gap-1",
                                answerMode === "thought"
                                  ? "bg-violet-600 text-white shadow-sm"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                              title={
                                answerMode === "thought"
                                  ? "Ход мыслей включён (нажмите для выключения)"
                                  : "Включить ход мыслей"
                              }
                              data-testid="toggle-thought-mode"
                              aria-pressed={answerMode === "thought"}
                            >
                              <SparklesIcon className="w-3 h-3" />
                              Ход мыслей
                            </button>
                          )}
                          {isButtonVisible("livecode") && (
                            <button
                              type="button"
                              onClick={() => handleToggleAnswerMode("livecode")}
                              className={cn(
                                "px-2 py-1 text-[11px] font-medium rounded transition-all flex items-center gap-1",
                                answerMode === "livecode"
                                  ? "bg-amber-600 text-white shadow-sm"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                              title={
                                answerMode === "livecode"
                                  ? "Лайвкодинг включён (нажмите для выключения)"
                                  : "Включить режим лайвкодинга"
                              }
                              data-testid="toggle-livecode-mode"
                              aria-pressed={answerMode === "livecode"}
                            >
                              <CodeIcon className="w-3 h-3" />
                              Лайвкодинг
                            </button>
                          )}
                        </div>
                      )}

                      {/* Кнопка ответа на последнюю реплику собеседника */}
                      {isButtonVisible("answer") && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => answerLastInterviewerUtterance?.()}
                          disabled={isAIProcessing || !hasInterviewerUtterance}
                          className="h-6 text-[11px] font-medium gap-1 px-2 shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                          title={
                            !hasInterviewerUtterance
                              ? "Нет реплики собеседника для ответа"
                              : isAIProcessing
                              ? "ИИ генерирует ответ..."
                              : "Ответить на последнюю реплику собеседника"
                          }
                        >
                          {isAIProcessing ? (
                            <LoaderIcon className="w-3 h-3 animate-spin" />
                          ) : (
                            <SparklesIcon className="w-3 h-3" />
                          )}
                          Ответить
                        </Button>
                      )}
                      {/* Code mode (R01): plan first, snippet on demand. */}
                      {isButtonVisible("code_plan") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => answerCodeForLastUtterance?.("plan")}
                          disabled={isAIProcessing || !hasInterviewerUtterance}
                          className="h-6 text-[11px] font-medium gap-1 px-2 shrink-0 text-muted-foreground hover:text-foreground"
                          title="Код: 1 фраза-план (Ctrl+Shift+K)"
                        >
                          План
                        </Button>
                      )}
                      {isButtonVisible("code_full") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => answerCodeForLastUtterance?.("full")}
                          disabled={isAIProcessing || !hasInterviewerUtterance}
                          className="h-6 text-[11px] font-medium gap-1 px-2 shrink-0 text-muted-foreground hover:text-foreground"
                          title="Код: фрагмент + объяснение"
                        >
                          Код
                        </Button>
                      )}
                      {isButtonVisible("code_screen") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => answerCodeForLastUtterance?.("full", { screenshot: true })}
                          disabled={isAIProcessing || !hasInterviewerUtterance}
                          className="h-6 text-[11px] font-medium gap-1 px-2 shrink-0 text-muted-foreground hover:text-foreground"
                          title="Код со скрина: захватить экран, прочитать код глазами модели, разбор + фрагмент"
                        >
                          Код со скрина
                        </Button>
                      )}
                      {isButtonVisible("monologue_send") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent("monologue:flush"));
                          }}
                          className="h-6 text-[11px] font-medium gap-1 px-2 shrink-0 text-muted-foreground hover:text-foreground"
                          title="Отправить накопленный монолог в нейронку"
                          data-testid="monologue-send-btn"
                        >
                          Монолог
                        </Button>
                      )}
                    </>
                  )}
                </div>

                {/* Right: Quick Actions, Screenshot, Settings & New */}
                <div className="flex flex-wrap items-center gap-x-1 gap-y-1 shrink-0 ml-auto">
                  {/* Screenshot Button */}
                  {supportsImages && isVadMode && !setupRequired && isButtonVisible("screenshot") && (
                    <Button
                      size="sm"
                      variant={screenshotImage ? "default" : "ghost"}
                      onClick={handleCaptureScreenshot}
                      disabled={
                        isCapturingScreenshot ||
                        isAIProcessing ||
                        !screenshotAllowed
                      }
                      className={cn(
                        "h-6 text-[10px] gap-1 px-2",
                        screenshotImage && "bg-primary text-primary-foreground"
                      )}
                      title={
                        screenshotAllowed
                          ? "Capture screenshot"
                          : "Screenshot входит в тариф Pro. Оплата пока недоступна."
                      }
                    >
                      {isCapturingScreenshot ? (
                        <LoaderIcon className="w-3 h-3 animate-spin" />
                      ) : (
                        <CameraIcon className="w-3 h-3" />
                      )}
                    </Button>
                  )}

                  {/* Quick AI Provider / Model Badge Dropdown (R04) */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] font-mono gap-1 px-2 shrink-0 text-violet-600 dark:text-violet-400 hover:text-foreground"
                        title={`Активный провайдер: ${effectiveProviderId || "не выбран"}${effectiveModel ? ` · Модель: ${effectiveModel}` : ""}. Клик — переключить провайдер.`}
                        data-testid="model-badge-trigger"
                      >
                        <span className="shrink-0">🤖</span>
                        <span className="truncate max-w-[120px]">
                          {effectiveProviderId && effectiveModel
                            ? `${effectiveProviderId}/${effectiveModel}`
                            : effectiveProviderId || effectiveModel || "AI"}
                        </span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="text-[0.7em] min-w-[160px]">
                      {!allAiProviders || allAiProviders.length === 0 ? (
                        <div className="px-2 py-1.5 text-muted-foreground text-xs">
                          Нет доступных провайдеров
                        </div>
                      ) : (
                        allAiProviders.map((p) => {
                          const isSelected = p.id === effectiveProviderId;
                          const pModel = resolveProviderModel(p, {
                            provider: p.id,
                            variables: getAIProviderVariables(p.id),
                          });
                          return (
                            <DropdownMenuItem
                              key={p.id}
                              onClick={() => handleSelectProvider(p.id)}
                              className={cn(
                                "gap-1 cursor-pointer",
                                isSelected && "bg-primary/10 font-medium"
                              )}
                              data-testid={`provider-option-${p.id}`}
                            >
                              {isSelected && <CheckIcon className="w-3 h-3" />}
                              <span className="font-mono">{p.id}</span>
                              {pModel && (
                                <span className="text-muted-foreground ml-auto truncate max-w-[120px]">
                                  ({pModel})
                                </span>
                              )}
                            </DropdownMenuItem>
                          );
                        })
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Settings */}
                  {!setupRequired && isButtonVisible("audio_settings") && (
                    <Button
                      size="sm"
                      variant={showSettingsDrawer ? "secondary" : "ghost"}
                      onClick={() => setShowSettingsDrawer((prev) => !prev)}
                      className="h-6 w-auto gap-1 px-2 text-[10px]"
                      title="Язык распознавания, чувствительность, режим записи"
                    >
                      <MicIcon className="w-3.5 h-3.5" />
                      Звук
                    </Button>
                  )}

                  {isButtonVisible("settings") && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => invoke("open_dashboard").catch(console.error)}
                      className="h-6 w-6"
                      title={`Все настройки${appVersion ? ` · версия ${appVersion}` : ""}`}
                    >
                      <SettingsIcon className="w-3.5 h-3.5" />
                    </Button>
                  )}

                  {appVersion && (
                    <span
                      className="font-mono text-[10px] text-muted-foreground shrink-0"
                      title="Версия приложения"
                    >
                      v{appVersion}
                    </span>
                  )}

                  {/* Start New Conversation Button */}
                  {!setupRequired && isButtonVisible("new_chat") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={startNewConversation}
                      className="h-6 text-[10px] gap-1 px-2"
                      title="Start a new conversation"
                    >
                      <PlusIcon className="w-3 h-3" />
                      New
                    </Button>
                  )}

                  {/* Close Button */}
                  {!capturing && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      title="Close"
                      onClick={() => {
                        setIsPopoverOpen(false);
                        resizeWindow(false);
                      }}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Main Full-Height ScrollArea for Answers & Text */}
            <ScrollArea className="flex-1 min-h-0 w-full min-w-0 max-w-full overflow-x-hidden" ref={scrollAreaRef}>
              <div className="p-2 space-y-2 w-full min-w-0 max-w-full overflow-x-hidden">
                {/* Screenshot Preview */}
                {screenshotImage && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
                    <img
                      src={`data:image/png;base64,${screenshotImage}`}
                      alt="Screenshot"
                      className="h-12 w-20 object-cover rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium">
                        Screenshot attached
                      </p>
                      <p className="text-[9px] text-muted-foreground">
                        Will be sent with next transcription
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={handleRemoveScreenshot}
                    >
                      <XIcon className="h-3 w-3" />
                    </Button>
                  </div>
                )}

                {/* Error Display */}
                {error && !setupRequired && (
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertCircleIcon className="w-4 h-4 text-red-500 shrink-0" />
                      <p className="text-xs truncate font-medium">{error}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => {
                          // The engine's port can drift (a restart rebounds it),
                          // and the message cannot be acted on from the settings
                          // window alone. Restarting the engine here re-checks
                          // liveness and re-resolves the port.
                          invoke("start_handy_server")
                            .then(() => {
                              props.clearError();
                              startCapture();
                            })
                            .catch(console.error);
                        }}
                        className="px-2 py-0.5 text-[10px] font-medium rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-700 dark:text-emerald-300 transition-colors"
                        title="Перезапустить локальный движок распознавания"
                      >
                        Перезапустить движок
                      </button>
                      <button
                        onClick={() => {
                          invoke("open_dashboard_page", { route: "/dev-space" }).catch(console.error);
                        }}
                        className="px-2 py-0.5 text-[10px] font-medium rounded bg-red-500/20 hover:bg-red-500/30 text-red-600 dark:text-red-300 transition-colors"
                      >
                        Настроить
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const p = props as any;
                          if (p.clearError) {
                            p.clearError();
                          } else if (p.setError) {
                            p.setError("");
                          }
                        }}
                        className="p-1 hover:bg-red-500/20 rounded transition-colors text-red-700 dark:text-red-300"
                        title="Закрыть ошибку"
                      >
                        <XIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Setup Required - Permission Flow */}
                {setupRequired ? (
                  <PermissionFlow
                    onPermissionGranted={() => {
                      startCapture();
                    }}
                    onPermissionDenied={() => {
                      // Keep showing setup instructions
                    }}
                  />
                ) : (
                  <>
                    {/* Recording Panel (Continuous Mode) */}
                    <RecordingPanel
                      isVadMode={isVadMode}
                      isRecording={isRecordingInContinuousMode}
                      isProcessing={isProcessing}
                      isAIProcessing={isAIProcessing}
                      recordingProgress={recordingProgress}
                      maxDuration={vadConfig.max_recording_duration_secs}
                      onStartRecording={startContinuousRecording}
                      onStopAndSend={props.manualStopAndSend}
                      onIgnore={props.ignoreContinuousRecording}
                    />

                    {/* Settings Panel (Collapsible Drawer from Top Bar) */}
                    {showSettingsDrawer && (
                      <div className="p-3 rounded-xl border border-primary/30 bg-muted/20 animate-in fade-in duration-150 mb-2">
                        <div className="flex items-center justify-between mb-2 pb-1 border-b border-border/40">
                          <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                            <Settings2Icon className="w-3.5 h-3.5" /> Audio & VAD Settings
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-5 w-5"
                            onClick={() => setShowSettingsDrawer(false)}
                          >
                            <XIcon className="w-3 h-3" />
                          </Button>
                        </div>
                        <SettingsPanel
                          vadConfig={vadConfig}
                          onUpdateVadConfig={updateVadConfiguration}
                          useSystemPrompt={useSystemPrompt}
                          setUseSystemPrompt={setUseSystemPrompt}
                          contextContent={contextContent}
                          setContextContent={setContextContent}
                          respondToMic={props.respondToMic}
                          setRespondToMic={props.setRespondToMic}
                        />
                      </div>
                    )}

                    {/* AI Response & Main Text Display */}
                    <ResultsSection
                      myLastTranscription={myLastTranscription}
                      theirLastTranscription={theirLastTranscription}
                      lastAIResponse={lastAIResponse}
                      isAIProcessing={isAIProcessing}
                      conversation={conversation}
                      conversationMode={conversationMode}
                      setConversationMode={setConversationMode}
                      liveSegments={props.liveSegments}
                      micSpeaking={props.micSpeaking}
                      micListening={props.micListening}
                      scrollAreaRef={scrollAreaRef}
                      pipelineError={props.error}
                      askAIForTranscript={askAIForTranscript}
                      activeFiller={activeFiller}
                      pendingUtteranceId={pendingUtteranceId}
                      isStalled={props.isStalled}
                      aiStatusMessage={props.aiStatusMessage}
                      stallNextId={props.stallNextId}
                      onStallWait={props.stallWait}
                      onStallRetry={props.stallRetry}
                      onStallNext={props.stallNext}
                      onOpenProviders={() => {
                        void invoke("open_dashboard_page", { route: "/dev-space" }).catch(console.error);
                      }}
                      activeProviderId={props.activeProviderId}
                      onSetSelectedAIProvider={props.onSetSelectedAIProvider}
                    />
                  </>
                )}
              </div>
            </ScrollArea>
            {/* Resize handle: drags the window's bottom edge. `startResizeDragging`
                resolves without doing anything on a transparent, undecorated
                window, so the height is driven directly instead. */}
            <div
              className="group flex h-4 w-full shrink-0 cursor-ns-resize items-center justify-center border-t border-border/40 bg-muted/20 hover:bg-muted/40 touch-none select-none"
              title="Потяните, чтобы изменить высоту панели"
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();

                const startY = e.screenY;
                const startHeight = window.innerHeight;
                let pending = startHeight;

                const onMouseMove = (move: MouseEvent) => {
                  const next = Math.max(
                    MIN_PANEL_HEIGHT,
                    Math.min(
                      window.screen.availHeight,
                      Math.round(startHeight + (move.screenY - startY))
                    )
                  );
                  if (next === pending) return;
                  pending = next;
                  rememberPanelHeight(next);
                  void invoke("set_window_height_absolute", {
                    window: getCurrentWindow(),
                    height: next,
                  }).catch((err) => console.error("Resize failed:", err));
                };
                const onMouseUp = () => {
                  window.removeEventListener("mousemove", onMouseMove);
                  window.removeEventListener("mouseup", onMouseUp);
                };

                window.addEventListener("mousemove", onMouseMove);
                window.addEventListener("mouseup", onMouseUp);
              }}
            >
              <div className="h-1 w-10 rounded-full bg-muted-foreground/40 transition-colors group-hover:bg-foreground" />
            </div>
          </div>
        </div>
  );

  return <>{panel && createPortal(panel, document.body)}</>;
};
