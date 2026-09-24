import { Card, Updater, DragButton, CustomCursor, Button } from "@/components";
import {
  SystemAudio,
  Completion,
  AudioVisualizer,
  StatusIndicator,
} from "./components";
import { useApp, useBarChrome } from "@/hooks";
import { useApp as useAppContext } from "@/contexts";
import { HeadphonesIcon, MicIcon, Eye, EyeOff, PinIcon } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  const { customizable, toggleStealthMode, toggleAlwaysOnTop } = useAppContext();
  const platform = getPlatform();
  useBarChrome();

  const handleDragMouseDown = async (e: React.MouseEvent) => {
    // Only drag with left mouse button
    if (e.button !== 0) return;
    // Anything interactive must not start a window drag. React portals forward
    // events through the React tree, so this handler still sees mousedown from the
    // docked panel and from Radix menus even though those live under <body> in the
    // DOM — and a menu row is a <div role="menuitem">, not a <button>, so dragging
    // used to start and swallow the click. Profiles looked like they would not
    // switch because the click never completed.
    const target = e.target as HTMLElement | null;
    if (
      target?.closest("[data-no-drag]") ||
      target?.closest("[data-radix-popper-content-wrapper]") ||
      target?.closest("button") ||
      target?.closest("input") ||
      target?.closest("textarea") ||
      target?.closest("select") ||
      target?.closest("a") ||
      target?.closest("[role='button']") ||
      target?.closest("[role='menuitem']") ||
      target?.closest("[role='option']") ||
      target?.closest("[role='tab']") ||
      target?.closest("[role='switch']") ||
      target?.closest(".no-drag")
    ) {
      return;
    }
    try {
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.debug("Failed to start dragging from bar:", err);
    }
  };

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
        className={`w-screen h-screen flex overflow-hidden justify-center items-start px-2 pt-1 ${
          isHidden ? "hidden pointer-events-none" : ""
        }`}
      >
        {systemAudio?.micBridge}
        <Card
          data-tauri-drag-region="true"
          onMouseDown={handleDragMouseDown}
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
          </div>

          {/* Pin: keeps the overlay above other windows while an interview is
              running, and lets it fall back to a normal window when the user
              needs to click through to their IDE. */}
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              "h-8 w-8 cursor-pointer shrink-0 transition-colors",
              customizable.alwaysOnTop?.isEnabled
                ? "text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
            title={
              customizable.alwaysOnTop?.isEnabled
                ? "Поверх всех окон: ВКЛ. Нажмите, чтобы сделать обычным окном."
                : "Поверх всех окон: ВЫКЛ. Нажмите, чтобы закрепить поверх остальных."
            }
            onClick={() => toggleAlwaysOnTop(!customizable.alwaysOnTop?.isEnabled)}
          >
            <PinIcon
              className={cn(
                "h-4 w-4",
                customizable.alwaysOnTop?.isEnabled ? "" : "opacity-70"
              )}
            />
          </Button>
          {/* Stealth Mode toggle button */}
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              "h-8 w-8 cursor-pointer shrink-0 transition-colors",
              customizable.stealth?.isEnabled
                ? "text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
            title={
              customizable.stealth?.isEnabled
                ? "Stealth Mode: ВКЛ (окно скрыто от записи/скриншотов). Нажмите, чтобы выключить."
                : "Stealth Mode: ВЫКЛ (окно видно на скриншотах/записи). Нажмите, чтобы включить."
            }
            onClick={() => toggleStealthMode(!customizable.stealth?.isEnabled)}
          >
            {customizable.stealth?.isEnabled ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4 opacity-70" />
            )}
          </Button>

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
