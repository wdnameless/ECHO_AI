/**
 * Pluely System Audio Hook
 *
 * Orchestrator hook for capturing system & mic audio, transcription via STT,
 * assembling interview questions, Russian filler phrasing during generation,
 * and streaming AI responses with custom prompts and context.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useWindowResize, useGlobalShortcuts } from ".";
import { useApp } from "@/contexts";
import {
  isExplicitAskEligible,
  selectRussianFiller,
} from "@/lib/transcript-stabilizer";
import {
  generateConversationId,
  generateMessageId,
  generateConversationTitle,
} from "@/lib";
import { DEFAULT_SYSTEM_PROMPT } from "@/config";
import { useMicCapture } from "./useMicCapture";
import {
  useConversationStore,
  LiveSegment,
  ChatMessage,
  ChatConversation,
} from "./useConversationStore";
import { useMicWsStreaming } from "./useMicWsStreaming";
import { useQuestionPipeline } from "./useQuestionPipeline";
import { useAIStreaming } from "./useAIStreaming";
import {
  useSystemAudioCapture,
  VadConfig,
  DEFAULT_VAD_CONFIG,
} from "./useSystemAudioCapture";
import { useContextQuickActions } from "./useContextQuickActions";
import { useSystemAudioKeyboard } from "./useSystemAudioKeyboard";
import { useAudioLifecycle } from "./useAudioLifecycle";

export type { LiveSegment, ChatMessage, ChatConversation, VadConfig };
export { DEFAULT_VAD_CONFIG };

export type useSystemAudioType = ReturnType<typeof useSystemAudio>;

/**
 * Main orchestrator hook for system and microphone audio capture, ASR transcription,
 * question assembly, and AI streaming response.
 */
export function useSystemAudio() {
  const { resizeWindow } = useWindowResize();
  const globalShortcuts = useGlobalShortcuts();

  // App context configuration
  const {
    selectedSttProvider,
    allSttProviders,
    selectedAIProvider,
    allAiProviders,
    systemPrompt,
    selectedAudioDevices,
  } = useApp();

  // Local state
  const [error, setError] = useState<string>("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // 1. Context & Quick Actions Settings Hook
  const {
    quickActions,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    useSystemPrompt,
    setUseSystemPrompt,
    setRawUseSystemPrompt,
    contextContent,
    setContextContent,
    respondToMic,
    setRespondToMic,
    addQuickAction,
    removeQuickAction,
  } = useContextQuickActions();

  // 2. Conversation Store Hook
  const {
    conversation,
    setConversation,
    liveSegments,
    liveSegmentsRef,
    setLiveSegments,
    myLastTranscription,
    setMyLastTranscription,
    theirLastTranscription,
    setTheirLastTranscription,
    appendLiveSegment,
    resetConversation,
    addInteraction,
    buildHistory,
  } = useConversationStore();

  // 3. Question Pipeline Hook (Assembler & Filler)
  const handleTriggerAIRef = useRef<
    (question: string, source: "me" | "them") => Promise<void>
  >(async () => {});

  const {
    activeFiller,
    setActiveFiller,
    pendingUtteranceId,
    setPendingUtteranceId,
    activeAskUtteranceIdRef,
    clearFiller,
    setFillerForInterviewer,
    resetQuestionAssembly,
    handleInterviewerTranscription,
  } = useQuestionPipeline({
    onTriggerAI: (q, s) => handleTriggerAIRef.current(q, s),
    liveSegmentsRef,
  });

  // 4. System Audio & Microphone Capture Subsystem
  const handleAbortAIRef = useRef<() => void>(() => {});
  const handleSetIsAIProcessingRef = useRef<(v: boolean) => void>(() => {});

  const {
    capturing,
    setCapturing,
    capturingRef,
    isMicProcessing,
    setIsMicProcessing,
    isSystemProcessing,
    setIsSystemProcessing,
    setupRequired,
    setSetupRequired,
    isPopoverOpen,
    setIsPopoverOpen,
    vadConfig,
    updateVadConfiguration,
    recordingProgress,
    setRecordingProgress,
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
    transcribeSegment,
    startContinuousRecording,
    ignoreContinuousRecording,
    manualStopAndSend,
    stopMicVisualizerStream,
  } = useSystemAudioCapture({
    selectedAudioDevices,
    selectedSttProvider,
    allSttProviders,
    appendLiveSegment,
    onInterviewerTranscription: handleInterviewerTranscription,
    setMyLastTranscription,
    setTheirLastTranscription,
    setIsAIProcessing: (v) => handleSetIsAIProcessingRef.current(v),
    setError,
  });

  // 5. AI Streaming Hook
  const handleSetLastAIResponseRef = useRef<(t: string) => void>(() => {});

  const {
    isAIProcessing,
    setIsAIProcessing,
    lastAIResponse,
    setLastAIResponse,
    processWithAI,
    triggerAIForQuestion,
    abortAI,
  } = useAIStreaming({
    selectedAIProvider,
    allAiProviders,
    systemPrompt,
    useSystemPrompt,
    contextContent,
    conversation,
    buildHistory,
    addInteraction,
    setFillerForInterviewer,
    clearFiller,
    pendingScreenshotRef,
    setPendingScreenshot,
    onError: setError,
  });

  handleTriggerAIRef.current = triggerAIForQuestion;
  handleAbortAIRef.current = abortAI;
  handleSetIsAIProcessingRef.current = setIsAIProcessing;
  handleSetLastAIResponseRef.current = setLastAIResponse;

  // 6. Mic WS Streaming Hook
  const {
    micWsWantRef,
    micWsConnect,
    micWsFinalizeAndClose,
    micFeedFrame,
    cleanupMicWs,
  } = useMicWsStreaming({
    capturingRef,
    onPartialTranscript: (text) => appendLiveSegment("me", text, true),
  });

  const isProcessing = isMicProcessing || isSystemProcessing;
  const lastTranscription =
    liveSegments.length > 0 ? liveSegments[liveSegments.length - 1].text : "";

  // Microphone capture via webview VAD
  const micCapture = useMicCapture({
    microphoneDeviceId: selectedAudioDevices.input.id,
    microphoneDeviceName: selectedAudioDevices.input.name,
    onMicSegment: (audioBlob) => {
      void transcribeSegment(audioBlob, "me");
    },
    onMicFrame: (pcm) => {
      micFeedFrame(pcm);
    },
    onMicSpeechStart: () => {
      micWsWantRef.current = true;
      micWsConnect();
    },
    onMicSpeechStop: () => {
      micWsFinalizeAndClose();
    },
    onInterimTranscript: (text) => {
      appendLiveSegment("me", text, true);
    },
  });

  const micStartRef = useRef<() => void>(() => {});
  const micStopRef = useRef<() => void>(() => {});
  useEffect(() => {
    micStartRef.current = () => {
      micCapture.start();
    };
    micStopRef.current = () => {
      cleanupMicWs();
      micCapture.stop();
    };
  });

  // 7. Audio Lifecycle (Start / Stop / Setup / Hardware permissions)
  const { startCapture, stopCapture, handleSetup } = useAudioLifecycle({
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
  });

  const handleQuickActionClick = async (action: string) => {
    setError("");
    const effectiveSystemPrompt = useSystemPrompt
      ? systemPrompt || DEFAULT_SYSTEM_PROMPT
      : contextContent || DEFAULT_SYSTEM_PROMPT;

    let updatedMessages = [...conversation.messages];
    const lastSegment = liveSegments.length > 0 ? liveSegments[liveSegments.length - 1] : null;
    if (lastSegment && lastSegment.text.trim()) {
      const newestMessage = updatedMessages[0];
      if (!newestMessage || newestMessage.content !== lastSegment.text) {
        const timestamp = Date.now();
        const userMessage: ChatMessage = {
          id: generateMessageId("user", timestamp),
          role: "user",
          content: lastSegment.text,
          timestamp,
          source: lastSegment.source,
        };
        updatedMessages = [userMessage, ...updatedMessages];
        setConversation((prev) => ({
          ...prev,
          messages: [userMessage, ...prev.messages],
          updatedAt: timestamp,
          title: prev.title || generateConversationTitle(lastSegment.text),
        }));
      }
    }

    const previousMessages = buildHistory(updatedMessages);
    await processWithAI(
      action,
      effectiveSystemPrompt,
      previousMessages,
      pendingScreenshotRef.current ? [pendingScreenshotRef.current] : []
    );
  };

  const askAIForTranscript = useCallback(
    async (utteranceId: string, text: string, source: "me" | "them") => {
      if (!isExplicitAskEligible(text)) {
        return;
      }

      if (isAIProcessing || activeAskUtteranceIdRef.current === utteranceId) {
        return;
      }

      const filler = selectRussianFiller();
      setActiveFiller(filler);
      setPendingUtteranceId(utteranceId);
      activeAskUtteranceIdRef.current = utteranceId;

      try {
        await triggerAIForQuestion(text, source);
      } catch (err) {
        console.warn("[system-audio]", err);
        clearFiller();
      }
    },
    [
      isAIProcessing,
      activeAskUtteranceIdRef,
      setActiveFiller,
      setPendingUtteranceId,
      triggerAIForQuestion,
      clearFiller,
    ]
  );

  useEffect(() => {
    if (micCapture.stream) {
      micStreamRef.current = micCapture.stream;
      setMicStream(micCapture.stream);
    } else {
      micStreamRef.current = null;
      setMicStream(null);
    }
  }, [micCapture.stream, setMicStream, micStreamRef]);

  useEffect(() => {
    if (capturing && micCapture.micErrored) {
      setError(
        `Microphone unavailable (${micCapture.micErrored}). Continuing with system audio only.`
      );
    }
  }, [capturing, micCapture.micErrored]);

  useEffect(() => {
    const shouldOpenPopover =
      capturing ||
      setupRequired ||
      isAIProcessing ||
      !!lastAIResponse ||
      !!error;
    setIsPopoverOpen(shouldOpenPopover);
    resizeWindow(shouldOpenPopover);
  }, [
    capturing,
    setupRequired,
    isAIProcessing,
    lastAIResponse,
    error,
    resizeWindow,
    setIsPopoverOpen,
  ]);

  const startNewConversation = useCallback(() => {
    resetQuestionAssembly();
    setConversation({
      id: generateConversationId("sysaudio"),
      title: "",
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    });
    setLiveSegments([]);
    setMyLastTranscription("");
    setTheirLastTranscription("");
    setLastAIResponse("");
    pendingScreenshotRef.current = null;
    setPendingScreenshot(null);
    setError("");
    setSetupRequired(false);
    setIsMicProcessing(false);
    setIsSystemProcessing(false);
    setIsAIProcessing(false);
    clearFiller();
    setIsPopoverOpen(false);
    setRawUseSystemPrompt(true);
  }, [
    resetQuestionAssembly, setConversation, setLiveSegments,
    setMyLastTranscription, setTheirLastTranscription, setLastAIResponse,
    pendingScreenshotRef, setPendingScreenshot, setError, setSetupRequired,
    setIsMicProcessing, setIsSystemProcessing, setIsAIProcessing,
    clearFiller, setIsPopoverOpen, setRawUseSystemPrompt,
  ]);

  // Hook 8. Keyboard & Scroll Shortcuts
  useSystemAudioKeyboard({
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
  });

  return {
    capturing,
    isProcessing,
    isMicProcessing,
    isSystemProcessing,
    isAIProcessing,
    lastTranscription,
    myLastTranscription,
    theirLastTranscription,
    liveSegments,
    lastAIResponse,
    activeFiller,
    pendingUtteranceId,
    askAIForTranscript,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    handleSetup,
    isPopoverOpen,
    setIsPopoverOpen,
    conversation,
    setConversation,
    processWithAI,
    useSystemPrompt,
    setUseSystemPrompt,
    contextContent,
    setContextContent,
    respondToMic,
    setRespondToMic,
    startNewConversation,
    resizeWindow,
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick,
    vadConfig,
    updateVadConfiguration,
    isContinuousMode,
    isRecordingInContinuousMode,
    recordingProgress,
    manualStopAndSend,
    startContinuousRecording,
    ignoreContinuousRecording,
    scrollAreaRef,
    micListening: micCapture.micListening,
    micSpeaking: micCapture.micSpeaking,
    micStream,
    micBridge: micCapture.bridge,
    pendingScreenshot,
    setPendingScreenshot,
  };
}
