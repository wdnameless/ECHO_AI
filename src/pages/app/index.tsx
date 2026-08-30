import { Card, Updater, DragButton, CustomCursor, Button } from "@/components";
import {
  SystemAudio,
  Completion,
  AudioVisualizer,
  StatusIndicator,
} from "./components";
import { useApp } from "@/hooks";
import { useApp as useAppContext } from "@/contexts";
import { HeadphonesIcon, SparklesIcon, MicIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "@/layouts";
import { getPlatform } from "@/lib";
import { useEffect } from "react";
import {
  applyFontSize,
  FONT_SIZE_STORAGE_KEY,
} from "@/pages/settings/components/FontSizeSettings";
import { safeLocalStorage } from "@/lib/storage/helper";
import { cn } from "@/lib/utils";

type AppMode = "dictation" | "meeting";

const App = () => {
  const { isHidden, systemAudio } = useApp();
  const { customizable } = useAppContext();
  const platform = getPlatform();

  // Explicit two-mode switch: dictation (bar input + AI) vs meeting copilot
  // (system audio capture + subtitle feed). The single source of truth is
  // systemAudio.capturing — the segmented control follows it.
  const mode: AppMode = systemAudio?.capturing ? "meeting" : "dictation";
  const switchMode = (next: AppMode) => {
    if (next === mode) return;
    if (next === "meeting") {
      void systemAudio?.startCapture();
    } else {
      void systemAudio?.stopCapture();
    }
  };

  // Apply the user's font size setting to the floating window too.
  useEffect(() => {
    const apply = () => {
      const size = safeLocalStorage.getItem(FONT_SIZE_STORAGE_KEY);
      if (size) {
        applyFontSize(size as "sm" | "base" | "lg" | "xl");
      }
    };
    apply();
    window.addEventListener("storage", apply);
    return () => window.removeEventListener("storage", apply);
  }, []);

  const openDashboard = async () => {
    try {
      await invoke("open_dashboard");
    } catch (error) {
      console.error("Failed to open dashboard:", error);
    }
  };

  return (
    <ErrorBoundary
      fallbackRender={() => {
        return <ErrorLayout isCompact />;
      }}
      resetKeys={["app-error"]}
      onReset={() => {
        console.log("Reset");
      }}
    >
      <div
        className={`w-screen h-screen flex overflow-hidden justify-center items-start ${
          isHidden ? "hidden pointer-events-none" : ""
        }`}
      >
        {systemAudio?.micBridge}
        <Card
          data-tauri-drag-region="true"
          className="w-full flex flex-row items-center gap-2 p-2 select-none"
        >
          {/* Mode switcher */}
          <div
            className="flex items-center rounded-lg border border-border/60 overflow-hidden shrink-0"
            title={
              mode === "meeting"
                ? "Режим встречи: копилот слушает собеседника (нажмите, чтобы вернуться к диктовке)"
                : "Режим диктовки: голосовой ввод в строку (нажмите, чтобы включить режим встречи)"
            }
          >
            <button
              onClick={() => switchMode("dictation")}
              className={cn(
                "flex items-center gap-1 px-2 py-1.5 text-[0.65em] font-medium transition-colors",
                mode === "dictation"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/50"
              )}
            >
              <MicIcon className="w-3 h-3" />
              Диктовка
            </button>
            <button
              onClick={() => switchMode("meeting")}
              className={cn(
                "flex items-center gap-1 px-2 py-1.5 text-[0.65em] font-medium transition-colors",
                mode === "meeting"
                  ? "bg-emerald-600 text-white"
                  : "text-muted-foreground hover:bg-muted/50"
              )}
            >
              <HeadphonesIcon className="w-3 h-3" />
              Встреча
            </button>
          </div>

          <SystemAudio {...systemAudio} />
          {systemAudio?.capturing ? (
            <div
              data-tauri-drag-region="true"
              className="flex flex-row items-center gap-2 justify-between w-full"
            >
              <div
                data-tauri-drag-region="true"
                className="flex flex-1 items-center gap-2"
              >
                <AudioVisualizer
                  isRecording={systemAudio?.capturing}
                  stream={systemAudio?.micStream}
                />
              </div>
              <div
                data-tauri-drag-region="true"
                className="flex !w-fit items-center gap-2"
              >
                <StatusIndicator
                  setupRequired={systemAudio.setupRequired}
                  error={systemAudio.error}
                  isProcessing={systemAudio.isProcessing}
                  isAIProcessing={systemAudio.isAIProcessing}
                  capturing={systemAudio.capturing}
                  micActive={systemAudio.micListening}
                  systemActive={systemAudio.capturing}
                  micSpeaking={systemAudio.micSpeaking}
                />
              </div>
            </div>
          ) : null}

          <div
            data-tauri-drag-region="true"
            className={`${
              systemAudio?.capturing
                ? "hidden w-full fade-out transition-all duration-300"
                : "w-full flex flex-row gap-2 items-center"
            }`}
          >
            <Completion isHidden={isHidden} suppressAutoVAD={systemAudio?.capturing} />
            <Button
              size={"icon"}
              className="cursor-pointer"
              title="Open Dev Space"
              onClick={openDashboard}
            >
              <SparklesIcon className="h-4 w-4" />
            </Button>
          </div>

          <Updater />
          <DragButton />
        </Card>
        {customizable.cursor.type === "invisible" && platform !== "linux" ? (
          <CustomCursor />
        ) : null}
      </div>
    </ErrorBoundary>
  );
};

export default App;
