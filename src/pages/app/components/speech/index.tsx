import { useState, useRef } from "react";
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
  SparklesIcon,
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
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "@/contexts";
import { canUseFeature, isDevBuild } from "@/lib/entitlements";

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
  } = props;
  const isVadMode = !isContinuousMode;
  const handleModeChange = (vadEnabled: boolean) => {
    if (setIsContinuousMode) {
      setIsContinuousMode(!vadEnabled);
    }
  };


  const [conversationMode, setConversationMode] = useState(false);
  const appVersion = useAppVersion();
  const { hasActiveLicense, supportsImages } = useApp();

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
      className="panel-docked z-50 select-none overflow-hidden rounded-xl border border-input/50 bg-background shadow-lg"
    >
          <div className="flex flex-col h-full max-w-full min-w-0 overflow-hidden">
            {/* Header - Top Control Toolbar (All actions consolidated at top!) */}
            <div className="flex-shrink-0 p-2.5 border-b border-border/50 bg-muted/10">
              <div className="flex items-center justify-between gap-1.5 min-w-0 w-full">
                {/* Left: Mode Switcher & VAD */}
                <div className="flex items-center gap-1.5 min-w-0">
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

                      {/* Кнопка ответа на последнюю реплику собеседника */}
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
                    </>
                  )}
                </div>

                {/* Right: Quick Actions, Screenshot, Settings & New */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Screenshot Button — остаётся видимой и объясняет причину,
                      когда возможность недоступна (R17), вместо исчезновения. */}
                  {supportsImages && isVadMode && !setupRequired && (
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

                  {/* Audio & VAD drawer: its own label and icon so the two
                      settings surfaces are distinguishable — two identical
                      gears used to sit side by side and do different things. */}
                  {!setupRequired && (
                    <Button
                      size="sm"
                      variant={showSettingsDrawer ? "secondary" : "ghost"}
                      onClick={() => setShowSettingsDrawer((prev) => !prev)}
                      className="h-6 w-auto gap-1 px-2 text-[10px]"
                      title="Язык распознавания, чувствительность, режим записи"
                    >
                      <Settings2Icon className="w-3.5 h-3.5" />
                      Звук
                    </Button>
                  )}

                  {/* One gear, one meaning: it opens the app's settings window.
                      A second gear used to sit beside it for the Audio & VAD
                      drawer, so two identical icons did two different things. */}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => invoke("open_dashboard").catch(console.error)}
                    className="h-6 w-6"
                    title={`Настройки${appVersion ? ` · версия ${appVersion}` : ""}`}
                  >
                    <SettingsIcon className="w-3.5 h-3.5" />
                  </Button>

                  {appVersion && (
                    <span
                      className="font-mono text-[10px] text-muted-foreground shrink-0"
                      title="Версия приложения"
                    >
                      v{appVersion}
                    </span>
                  )}

                  {/* Start New Conversation Button */}
                  {!setupRequired && (
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
