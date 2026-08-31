import { useState, useRef } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  ScrollArea,
} from "@/components";
import { PermissionFlow } from "./PermissionFlow";
import {
  AlertCircleIcon,
  MessageSquareQuoteIcon,
  RadioIcon,
  CameraIcon,
  XIcon,
  PlusIcon,
  LoaderIcon,
  Settings2Icon,
  ZapIcon,
} from "lucide-react";
import { ModeSwitcher } from "./ModeSwitcher";
import { QuickActions } from "./QuickActions";
import { ResultsSection } from "./ResultsSection";
import { SettingsPanel } from "./SettingsPanel";
import { RecordingPanel } from "./RecordingPanel";
import { useSystemAudio } from "@/hooks";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "@/contexts";

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
    isPopoverOpen,
    isContinuousMode,
    isRecordingInContinuousMode,
    setupRequired,
    quickActions,
    isManagingQuickActions,
    showQuickActions,
    setIsPopoverOpen,
    setUseSystemPrompt,
    setContextContent,
    updateVadConfiguration,
    startCapture,
    stopCapture,
    startContinuousRecording,
    handleQuickActionClick,
    addQuickAction,
    removeQuickAction,
    setIsManagingQuickActions,
    setShowQuickActions,
    startNewConversation,
    setPendingScreenshot,
    resizeWindow,
  } = props;

  const isVadMode = !isContinuousMode;
  const handleModeChange = (vad: boolean) => {
    if (vad) {
      if (isContinuousMode) {
        props.ignoreContinuousRecording();
      }
    } else {
      if (!isContinuousMode) {
        startContinuousRecording();
      }
    }
  };

  const [conversationMode, setConversationMode] = useState(false);
  const { hasActiveLicense, supportsImages } = useApp();

  const [screenshotImage, setScreenshotImage] = useState<string | null>(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [showQuickActionsDropdown, setShowQuickActionsDropdown] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const handleToggleCapture = async () => {
    if (capturing) {
      await stopCapture();
    } else {
      await startCapture();
    }
  };

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

  const getButtonIcon = () => {
    if (error && !setupRequired)
      return <AlertCircleIcon className="w-3.5 h-3.5 text-red-500" />;
    if (capturing)
      return <RadioIcon className="w-3.5 h-3.5 text-green-500 animate-pulse" />;
    return <MessageSquareQuoteIcon className="w-3.5 h-3.5 text-primary" />;
  };

  const getButtonTitle = () => {
    if (setupRequired) return "Setup Required";
    if (error && !setupRequired) return `Error: ${error}`;
    if (capturing) return "Stop live conversation copilot";
    return "Start live conversation copilot";
  };

  const hasResponse =
    !!lastAIResponse ||
    isAIProcessing ||
    !!myLastTranscription ||
    !!theirLastTranscription;

  return (
    <Popover
      open={isPopoverOpen}
      onOpenChange={(open) => {
        if (capturing && !open) {
          return;
        }
        setIsPopoverOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="icon"
          title={getButtonTitle()}
          onClick={handleToggleCapture}
          className={cn(
            capturing && "bg-green-50 hover:bg-green-100 dark:bg-green-950/40",
            error && "bg-red-100 hover:bg-red-200"
          )}
        >
          {getButtonIcon()}
        </Button>
      </PopoverTrigger>

      {(capturing || setupRequired || error) && (
        <PopoverContent
          align="end"
          side="bottom"
          className="select-none w-screen max-w-full min-w-0 p-0 border shadow-lg overflow-hidden border-input/50"
          sideOffset={8}
        >
          <div className="flex flex-col h-[calc(100vh-3.2rem)] max-w-full min-w-0 overflow-hidden">
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
                </div>

                {/* Right: Quick Actions, Screenshot, Settings & New */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Quick Actions Button (Top Bar Dropdown/Drawer) */}
                  {!setupRequired && hasResponse && (
                    <Button
                      size="sm"
                      variant={showQuickActionsDropdown ? "secondary" : "ghost"}
                      onClick={() => setShowQuickActionsDropdown((prev) => !prev)}
                      className="h-6 px-2 text-[10px] gap-1 font-medium"
                      title="Quick prompt actions"
                    >
                      <ZapIcon className="w-3 h-3 text-amber-500" />
                      <span>Prompts</span>
                    </Button>
                  )}

                  {/* Screenshot Button */}
                  {hasActiveLicense &&
                    supportsImages &&
                    isVadMode &&
                    !setupRequired && (
                      <Button
                        size="sm"
                        variant={screenshotImage ? "default" : "ghost"}
                        onClick={handleCaptureScreenshot}
                        disabled={isCapturingScreenshot || isAIProcessing}
                        className={cn(
                          "h-6 text-[10px] gap-1 px-2",
                          screenshotImage && "bg-primary text-primary-foreground"
                        )}
                        title="Capture screenshot"
                      >
                        {isCapturingScreenshot ? (
                          <LoaderIcon className="w-3 h-3 animate-spin" />
                        ) : (
                          <CameraIcon className="w-3 h-3" />
                        )}
                      </Button>
                    )}

                  {/* Settings Drawer Toggle */}
                  <Button
                    size="icon"
                    variant={showSettingsDrawer ? "secondary" : "ghost"}
                    onClick={() => setShowSettingsDrawer((prev) => !prev)}
                    className="h-6 w-6"
                    title="Audio & AI Context Settings"
                  >
                    <Settings2Icon className="w-3.5 h-3.5" />
                  </Button>

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

              {/* Quick Actions Drawer (When Prompts button is clicked) */}
              {showQuickActionsDropdown && !setupRequired && hasResponse && (
                <div className="pt-2 mt-1.5 border-t border-border/40 animate-in fade-in duration-150">
                  <QuickActions
                    actions={quickActions}
                    onActionClick={(action) => {
                      handleQuickActionClick(action);
                      setShowQuickActionsDropdown(false);
                    }}
                    onAddAction={addQuickAction}
                    onRemoveAction={removeQuickAction}
                    isManaging={isManagingQuickActions}
                    setIsManaging={setIsManagingQuickActions}
                    show={showQuickActions}
                    setShow={setShowQuickActions}
                  />
                </div>
              )}
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
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                    <AlertCircleIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-medium text-red-800">
                        Error
                      </p>
                      <p className="text-[10px] text-red-700">{error}</p>
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
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
};
