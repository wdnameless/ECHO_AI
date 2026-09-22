/**
 * Audio Capture Session Lifecycle management hook.
 *
 * Responsibility:
 * - Start / Stop system audio and microphone capture workflows.
 * - Hardware / OS system audio permission checking & setup wizard invocation.
 * - Lifecycle cleanup upon unmount.
 */

import { useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VadConfig } from "./useSystemAudioCapture";

export interface UseAudioLifecycleProps {
  vadConfig: VadConfig;
  selectedAudioDevices: {
    input: { id: string; name: string };
    output: { id: string; name: string };
  };
  setCapturing: (v: boolean) => void;
  resetConversation: (prefix?: "chat" | "sysaudio") => void;
  setIsPopoverOpen: (v: boolean) => void;
  setIsContinuousMode: (v: boolean) => void;
  setRecordingProgress: (v: number) => void;
  setIsRecordingInContinuousMode: (v: boolean) => void;
  setSetupRequired: (v: boolean) => void;
  setError: (msg: string) => void;
  abortAI: () => void;
  micStartRef: React.MutableRefObject<() => void>;
  micStopRef: React.MutableRefObject<() => void>;
  micStreamRef: React.MutableRefObject<MediaStream | null>;
  stopMicVisualizerStream: () => void;
  resetQuestionAssembly: () => void;
  setIsMicProcessing: (v: boolean) => void;
  setIsSystemProcessing: (v: boolean) => void;
  setIsAIProcessing: (v: boolean) => void;
  setLiveSegments: (segments: any[]) => void;
  setMyLastTranscription: (t: string) => void;
  setTheirLastTranscription: (t: string) => void;
  setLastAIResponse: (t: string) => void;
  pendingScreenshotRef: React.MutableRefObject<string | null>;
  setPendingScreenshot: (s: string | null) => void;
  clearFiller: () => void;
}

export function useAudioLifecycle({
  vadConfig,
  selectedAudioDevices,
  setCapturing,
  resetConversation,
  setIsPopoverOpen,
  setIsContinuousMode,
  setRecordingProgress,
  setIsRecordingInContinuousMode,
  setSetupRequired,
  setError,
  abortAI,
  micStartRef,
  micStopRef,
  micStreamRef,
  stopMicVisualizerStream,
  resetQuestionAssembly,
  setIsMicProcessing,
  setIsSystemProcessing,
  setIsAIProcessing,
  setLiveSegments,
  setMyLastTranscription,
  setTheirLastTranscription,
  setLastAIResponse,
  pendingScreenshotRef,
  setPendingScreenshot,
  clearFiller,
}: UseAudioLifecycleProps) {
  const startCapture = useCallback(async () => {
    try {
      setError("");

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (!hasAccess) {
        setSetupRequired(true);
        setIsPopoverOpen(true);
        return;
      }

      const isContinuous = !vadConfig.enabled;
      resetConversation("sysaudio");

      setCapturing(true);
      setIsPopoverOpen(true);
      setIsContinuousMode(isContinuous);
      setRecordingProgress(0);

      if (isContinuous) {
        setIsRecordingInContinuousMode(false);
        return;
      }

      await invoke<string>("stop_system_audio_capture");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
      });

      try {
        micStartRef.current();
      } catch (micError) {
        console.error("Failed to start microphone capture:", micError);
        setError(
          "Microphone capture failed to start. Continuing with system audio only."
        );
      }
    } catch (err) {
      console.warn("[audio-capture]", err);
      // The flag is set optimistically before the backend is asked, so a failure
      // here has to take it back: otherwise the UI claims to record while
      // nothing is being captured.
      setCapturing(false);
      setIsSystemProcessing(false);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setIsPopoverOpen(true);
    }
  }, [
    vadConfig,
    selectedAudioDevices.output.id,
    resetConversation,
    setCapturing,
    setIsPopoverOpen,
    setIsContinuousMode,
    setRecordingProgress,
    setIsRecordingInContinuousMode,
    setSetupRequired,
    setError,
    micStartRef,
  ]);

  const stopCapture = useCallback(async () => {
    try {
      abortAI();
      await invoke<string>("stop_system_audio_capture");

      micStopRef.current();
      stopMicVisualizerStream();
      resetQuestionAssembly();

      setCapturing(false);
      setIsMicProcessing(false);
      setIsSystemProcessing(false);
      setIsAIProcessing(false);
      setIsContinuousMode(false);
      setIsRecordingInContinuousMode(false);
      setRecordingProgress(0);
      setLiveSegments([]);
      setMyLastTranscription("");
      setTheirLastTranscription("");
      setLastAIResponse("");
      pendingScreenshotRef.current = null;
      setPendingScreenshot(null);
      clearFiller();
      setError("");
      setIsPopoverOpen(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to stop capture: ${errorMessage}`);
      console.error("Stop capture error:", err);
    }
  }, [
    abortAI,
    micStopRef,
    stopMicVisualizerStream,
    resetQuestionAssembly,
    setCapturing,
    setIsMicProcessing,
    setIsSystemProcessing,
    setIsAIProcessing,
    setIsContinuousMode,
    setIsRecordingInContinuousMode,
    setRecordingProgress,
    setLiveSegments,
    setMyLastTranscription,
    setTheirLastTranscription,
    setLastAIResponse,
    pendingScreenshotRef,
    setPendingScreenshot,
    clearFiller,
    setError,
    setIsPopoverOpen,
  ]);

  const handleSetup = useCallback(async () => {
    try {
      const platform = navigator.platform.toLowerCase();

      if (platform.includes("mac") || platform.includes("win")) {
        await invoke("request_system_audio_access");
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 3000));

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (hasAccess) {
        setSetupRequired(false);
        await startCapture();
      } else {
        setSetupRequired(true);
        setError("Permission not granted. Please try the manual steps.");
      }
    } catch (err) {
      console.warn("[system-audio]", err);
      setError("Failed to request access. Please try the manual steps below.");
      setSetupRequired(true);
    }
  }, [startCapture, setSetupRequired, setError]);

  useEffect(() => {
    return () => {
      abortAI();
      micStopRef.current();
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
      }
      invoke("stop_system_audio_capture").catch((err) => {
        console.warn("[system-audio]", err);
      });
    };
  }, [abortAI, micStopRef, micStreamRef]);

  return {
    startCapture,
    stopCapture,
    handleSetup,
  };
}
