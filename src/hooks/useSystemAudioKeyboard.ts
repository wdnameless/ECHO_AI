/**
 * UI Keyboard shortcuts and window scrolling handling for system audio popover.
 *
 * Responsibility:
 * - Listens for ArrowUp / ArrowDown to scroll the popover scroll area.
 * - Handles continuous recording hotkeys (Enter, Escape, Space).
 * - Registers global desktop shortcut callbacks for toggling audio capture.
 */

import { useEffect, RefObject } from "react";
import { micStateStore } from "@/stores/mic-state";

export interface UseSystemAudioKeyboardProps {
  isPopoverOpen: boolean;
  isContinuousMode: boolean;
  isRecordingInContinuousMode: boolean;
  isProcessing: boolean;
  isAIProcessing: boolean;
  capturing: boolean;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  startContinuousRecording: () => void;
  manualStopAndSend: () => void;
  ignoreContinuousRecording: () => void;
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<void>;
  globalShortcuts: {
    registerSystemAudioCallback: (cb: () => Promise<void>) => (() => void) | void;
    registerAssistantAudioCallback?: (cb: () => Promise<void>) => (() => void) | void;
  };
}

export function useSystemAudioKeyboard({
  isPopoverOpen,
  isContinuousMode,
  isRecordingInContinuousMode,
  isProcessing,
  isAIProcessing,
  capturing,
  scrollAreaRef,
  startContinuousRecording,
  manualStopAndSend,
  ignoreContinuousRecording,
  startCapture,
  stopCapture,
  globalShortcuts,
}: UseSystemAudioKeyboardProps) {
  // Arrow keys navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      const scrollElement = scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]"
      ) as HTMLElement;

      if (!scrollElement) return;

      const scrollAmount = 100;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollElement.scrollBy({ top: scrollAmount, behavior: "smooth" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollElement.scrollBy({ top: -scrollAmount, behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen, scrollAreaRef]);

  // Continuous recording keyboard shortcuts
  useEffect(() => {
    const handleRecordingShortcuts = (e: KeyboardEvent) => {
      if (!isPopoverOpen || !isContinuousMode) return;
      if (isProcessing || isAIProcessing) return;

      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (!isRecordingInContinuousMode) {
          startContinuousRecording();
        } else {
          manualStopAndSend();
        }
      }

      if (e.key === "Escape" && isRecordingInContinuousMode) {
        e.preventDefault();
        ignoreContinuousRecording();
      }

      if (
        e.key === " " &&
        !isRecordingInContinuousMode &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        startContinuousRecording();
      }
    };

    window.addEventListener("keydown", handleRecordingShortcuts);
    return () =>
      window.removeEventListener("keydown", handleRecordingShortcuts);
  }, [
    isPopoverOpen,
    isContinuousMode,
    isRecordingInContinuousMode,
    isProcessing,
    isAIProcessing,
    startContinuousRecording,
    manualStopAndSend,
    ignoreContinuousRecording,
  ]);

  // Global system audio shortcut (Dictation / Interview toggle)
  useEffect(() => {
    return globalShortcuts.registerSystemAudioCallback(async () => {
      if (capturing) {
        await stopCapture();
      } else {
        await startCapture();
      }
    });
  }, [capturing, startCapture, stopCapture, globalShortcuts]);

  // Global assistant voice shortcut
  useEffect(() => {
    if (globalShortcuts.registerAssistantAudioCallback) {
      globalShortcuts.registerAssistantAudioCallback(async () => {
        // Toggle assistant mode
        const current = micStateStore.getState().mode;
        if (current === "ASSISTANT") {
          micStateStore.setMode("IDLE");
        } else {
          micStateStore.setMode("ASSISTANT");
        }
      });
    }
  }, [globalShortcuts]);
}
