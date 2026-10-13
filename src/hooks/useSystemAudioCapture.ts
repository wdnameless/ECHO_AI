import { useCallback, useRef } from "react";
import {
  type VadConfig,
  DEFAULT_VAD_CONFIG,
  FLUSH_SAFETY_TIMEOUT_MS,
  decodeSpeechFramePayload,
  hasSpeechEnergy,
  type UseSystemAudioCaptureProps,
} from "./audio/types";
import { useCapture } from "./audio/useCapture";
import { useRecovery } from "./audio/useRecovery";
import { useTranscribe } from "./audio/useTranscribe";

export {
  type VadConfig,
  DEFAULT_VAD_CONFIG,
  FLUSH_SAFETY_TIMEOUT_MS,
  decodeSpeechFramePayload,
  hasSpeechEnergy,
  type UseSystemAudioCaptureProps,
};

export function useSystemAudioCapture(props: UseSystemAudioCaptureProps) {
  const {
    selectedAudioDevices,
    selectedSttProvider,
    appendLiveSegment,
    onInterviewerTranscription,
    onInterviewerSpeechActivity,
    setMyLastTranscription,
    setTheirLastTranscription,
    setIsAIProcessing,
    setError,
  } = props;

  const setIsSystemProcessingRef = useRef<(v: boolean) => void>(() => {});
  const handleSetIsSystemProcessing = useCallback((v: boolean) => {
    setIsSystemProcessingRef.current(v);
  }, []);

  const setRecordingProgressRef = useRef<(v: number) => void>(() => {});
  const handleSetRecordingProgress = useCallback((v: number) => {
    setRecordingProgressRef.current(v);
  }, []);

  const capture = useCapture({
    selectedAudioDevices,
    setError,
    setIsSystemProcessing: handleSetIsSystemProcessing,
    setRecordingProgress: handleSetRecordingProgress,
  });

  const onSpeechDiscardedRef = useRef<() => void>(() => {});
  const handleSpeechDiscarded = useCallback(() => {
    onSpeechDiscardedRef.current();
  }, []);

  const handleSetIsRecordingInContinuousMode = useCallback(
    (v: boolean) => {
      capture.setIsRecordingInContinuousMode(v);
    },
    [capture]
  );

  const recovery = useRecovery({
    setIsSystemProcessing: handleSetIsSystemProcessing,
    setIsAIProcessing,
    setIsRecordingInContinuousMode: handleSetIsRecordingInContinuousMode,
    setError,
    onSpeechDiscarded: handleSpeechDiscarded,
  });
  setRecordingProgressRef.current = recovery.setRecordingProgress;

  const transcribe = useTranscribe({
    capturing: capture.capturing,
    capturingRef: capture.capturingRef,
    captureEpochRef: recovery.captureEpochRef,
    speechEpochRef: recovery.speechEpochRef,
    vadConfig: capture.vadConfig,
    selectedSttProvider,
    appendLiveSegment,
    onInterviewerTranscription,
    onInterviewerSpeechActivity,
    setMyLastTranscription,
    setTheirLastTranscription,
    setError,
    clearFlushSafety: recovery.clearFlushSafety,
    scheduleFlushSafety: recovery.scheduleFlushSafety,
    markSpeechEnd: recovery.markSpeechEnd,
    recordSpeechStart: recovery.recordSpeechStart,
    pauseBeforeUtteranceRef: recovery.pauseBeforeUtteranceRef,
    utteranceStartedAtRef: recovery.utteranceStartedAtRef,
  });
  setIsSystemProcessingRef.current = transcribe.setIsSystemProcessing;
  onSpeechDiscardedRef.current = transcribe.onSpeechDiscarded;

  const setCapturing = useCallback(
    (value: boolean | ((previous: boolean) => boolean)) => {
      const next =
        typeof value === "function" ? value(capture.capturingRef.current) : value;
      if (next !== capture.capturingRef.current) {
        recovery.captureEpochRef.current += 1;
        recovery.speechEpochRef.current += 1;
        capture.capturingRef.current = next;
        recovery.clearFlushSafety();
        transcribe.resetOnCaptureChange(next);
      }
      capture.setCapturingState(next);
    },
    [capture, recovery, transcribe]
  );

  return {
    capturing: capture.capturing,
    setCapturing,
    capturingRef: capture.capturingRef,
    isMicProcessing: transcribe.isMicProcessing,
    setIsMicProcessing: transcribe.setIsMicProcessing,
    isSystemProcessing: transcribe.isSystemProcessing,
    setIsSystemProcessing: transcribe.setIsSystemProcessing,
    setupRequired: capture.setupRequired,
    setSetupRequired: capture.setSetupRequired,
    isPopoverOpen: capture.isPopoverOpen,
    setIsPopoverOpen: capture.setIsPopoverOpen,
    vadConfig: capture.vadConfig,
    setVadConfig: capture.setVadConfig,
    updateVadConfiguration: capture.updateVadConfiguration,
    recordingProgress: recovery.recordingProgress,
    setRecordingProgress: recovery.setRecordingProgress,
    isContinuousMode: capture.isContinuousMode,
    setIsContinuousMode: capture.setIsContinuousMode,
    isRecordingInContinuousMode: capture.isRecordingInContinuousMode,
    setIsRecordingInContinuousMode: capture.setIsRecordingInContinuousMode,
    pendingScreenshot: capture.pendingScreenshot,
    setPendingScreenshot: capture.setPendingScreenshot,
    pendingScreenshotRef: capture.pendingScreenshotRef,
    micStream: capture.micStream,
    setMicStream: capture.setMicStream,
    micStreamRef: capture.micStreamRef,
    transcribeSegment: transcribe.transcribeSegment,
    canStream: transcribe.canStream,
    themIsStreaming: transcribe.themIsStreaming,
    yieldThemToMic: transcribe.yieldThemToMic,
    releaseMicModelOwnership: transcribe.releaseMicModelOwnership,
    startContinuousRecording: capture.startContinuousRecording,
    ignoreContinuousRecording: capture.ignoreContinuousRecording,
    manualStopAndSend: capture.manualStopAndSend,
    stopMicVisualizerStream: capture.stopMicVisualizerStream,
  };
}
