import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { safeLocalStorage } from "@/lib";
import { DEFAULT_VAD_CONFIG, type VadConfig } from "./types";

export interface UseCaptureProps {
  selectedAudioDevices: {
    input: { id: string; name: string };
    output: { id: string; name: string };
  };
  setError: (err: string) => void;
  setIsSystemProcessing: (v: boolean) => void;
  setRecordingProgress: (v: number) => void;
}

export function useCapture({
  selectedAudioDevices,
  setError,
  setIsSystemProcessing,
  setRecordingProgress,
}: UseCaptureProps) {
  const [capturing, setCapturingState] = useState(false);
  const capturingRef = useRef<boolean>(capturing);

  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const [vadConfig, setVadConfig] = useState<VadConfig>(DEFAULT_VAD_CONFIG);
  const [isContinuousMode, setIsContinuousMode] = useState<boolean>(false);
  const [isRecordingInContinuousMode, setIsRecordingInContinuousMode] =
    useState<boolean>(false);

  const [pendingScreenshot, setPendingScreenshot] = useState<string | null>(null);
  const pendingScreenshotRef = useRef<string | null>(null);

  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    capturingRef.current = capturing;
  }, [capturing]);

  useEffect(() => {
    pendingScreenshotRef.current = pendingScreenshot;
  }, [pendingScreenshot]);

  useEffect(() => {
    const savedVadConfig = safeLocalStorage.getItem("vad_config");
    if (savedVadConfig) {
      try {
        const parsed = JSON.parse(savedVadConfig);
        setVadConfig(parsed);
      } catch (err) {
        console.error("Failed to load VAD config:", err);
      }
    }
  }, []);

  const updateVadConfiguration = useCallback(async (config: VadConfig) => {
    try {
      setVadConfig(config);
      safeLocalStorage.setItem("vad_config", JSON.stringify(config));
      await invoke("update_vad_config", { config });
    } catch (err) {
      console.error("Failed to update VAD config:", err);
    }
  }, []);

  useEffect(() => {
    if (capturing) {
      setIsContinuousMode(!vadConfig.enabled);
      if (!vadConfig.enabled) {
        setIsRecordingInContinuousMode(false);
      }
    }
  }, [vadConfig.enabled, capturing]);

  const startContinuousRecording = useCallback(async () => {
    try {
      setRecordingProgress(0);
      setError("");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
      });
    } catch (err) {
      console.error("Failed to start continuous recording:", err);
      setError(`Failed to start recording: ${err}`);
    }
  }, [vadConfig, selectedAudioDevices.output.id, setError, setRecordingProgress]);

  const ignoreContinuousRecording = useCallback(async () => {
    try {
      if (!isContinuousMode || !isRecordingInContinuousMode) return;

      await invoke<string>("stop_system_audio_capture");

      setRecordingProgress(0);
      setIsSystemProcessing(false);
      setIsRecordingInContinuousMode(false);
    } catch (err) {
      console.error("Failed to ignore recording:", err);
      setError(`Failed to ignore recording: ${err}`);
    }
  }, [isContinuousMode, isRecordingInContinuousMode, setError, setIsSystemProcessing, setRecordingProgress]);

  const manualStopAndSend = useCallback(async () => {
    try {
      if (!isContinuousMode) {
        console.warn("Not in continuous mode");
        return;
      }

      setIsSystemProcessing(true);
      await invoke("manual_stop_continuous");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to manually stop: ${errorMessage}`);
      setIsSystemProcessing(false);
      console.error("Manual stop error:", err);
    }
  }, [isContinuousMode, setError, setIsSystemProcessing]);

  const stopMicVisualizerStream = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      setMicStream(null);
    }
  }, []);

  return {
    capturing,
    setCapturingState,
    capturingRef,
    setupRequired,
    setSetupRequired,
    isPopoverOpen,
    setIsPopoverOpen,
    vadConfig,
    setVadConfig,
    updateVadConfiguration,
    isContinuousMode,
    setIsContinuousMode,
    isRecordingInContinuousMode,
    setIsRecordingInContinuousMode,
    pendingScreenshot,
    setPendingScreenshot,
    pendingScreenshotRef,
    micStream,
    setMicStream,
    micStreamRef,
    stopMicVisualizerStream,
    startContinuousRecording,
    ignoreContinuousRecording,
    manualStopAndSend,
  };
}
