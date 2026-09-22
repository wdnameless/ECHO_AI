/**
 * Echo AI System Audio Hook
 *
 * Orchestrator hook for capturing system & mic audio, transcription via STT,
 * assembling interview questions, Russian filler phrasing during generation,
 * and streaming AI responses with custom prompts and context.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWindowResize, useGlobalShortcuts } from ".";
import { useApp } from "@/contexts";
import { isExplicitAskEligible } from "@/lib/transcript-stabilizer";
import {
  generateConversationId,
  getAutoAskConfig,
  saveAutoAskConfig,
  AutoAskManager,
  AutoAskMode,
} from "@/lib";
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
import { useAudioContextSettings } from "./useAudioContextSettings";
import { useSystemAudioKeyboard } from "./useSystemAudioKeyboard";
import { useAudioLifecycle } from "./useAudioLifecycle";
import { micStateStore } from "@/stores/mic-state";

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

  // 1. Audio Context Settings Hook
  const {
    useSystemPrompt,
    setUseSystemPrompt,
    setRawUseSystemPrompt,
    contextContent,
    setContextContent,
    respondToMic,
    setRespondToMic,
  } = useAudioContextSettings();

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

  // Permission to send is decided here. What the question is, and when a pause
  // ended it, stays the assembler's job: it flushes on silence gaps, so a
  // fragmented utterance is answered once, as one question.
  const isAIProcessingRef = useRef(false);
  const lastInterviewerQuestionRef = useRef<string | null>(null);

  const autoAskManagerRef = useRef<AutoAskManager | null>(null);
  if (!autoAskManagerRef.current) {
    autoAskManagerRef.current = new AutoAskManager({
      getConfig: getAutoAskConfig,
      isAIProcessing: () => isAIProcessingRef.current,
      onDispatch: (question) => {
        void handleTriggerAIRef.current(question, "them");
      },
    });
  }

  const [autoAskMode, setAutoAskModeState] = useState<AutoAskMode>(
    () => getAutoAskConfig().mode
  );

  const setAutoAskMode = useCallback((mode: AutoAskMode) => {
    saveAutoAskConfig({ mode });
    setAutoAskModeState(mode);
    // Leaving auto drops anything already waiting for its silence window.
    if (mode === "manual") {
      autoAskManagerRef.current?.cancel();
    }
  }, []);

  const dispatchAssembledQuestion = useCallback(
    async (question: string, source: "me" | "them") => {
      if (source !== "them") {
        await handleTriggerAIRef.current(question, source);
        return;
      }
      // The manual button answers this question; in auto mode the manager holds
      // it for the silence window and drops it when the mode changes or speech
      // resumes.
      lastInterviewerQuestionRef.current = question;
      autoAskManagerRef.current?.onFinalizedTranscript(question);
    },
    []
  );

  const {
    activeFiller,
    pendingUtteranceId,
    activeAskUtteranceIdRef,
    clearFiller,
    setFillerForAnchor,
    setFillerForInterviewer,
    resetQuestionAssembly,
    handleInterviewerTranscription,
  } = useQuestionPipeline({
    onTriggerAI: dispatchAssembledQuestion,
    liveSegmentsRef,
  });

  /**
   * A finished utterance arms the silence window on its own text; the assembler
   * may replace it with the merged question while the window is still open.
   *
   * The assembler alone is not enough: it holds a question as "pending" while
   * the text still reads unfinished, and with no other trigger a long monologue
   * would never be answered at all.
   */
  const handleBatchInterviewerTranscription = useCallback(
    async (transcription: string) => {
      await handleInterviewerTranscription(transcription);
      autoAskManagerRef.current?.onFinalizedTranscript(transcription);
    },
    [handleInterviewerTranscription]
  );

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
    onInterviewerTranscription: handleBatchInterviewerTranscription,
    onInterviewerSpeechActivity: () => autoAskManagerRef.current?.cancel(),
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
    pendingUtteranceId,
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
    onPartialTranscript: (text) => {
      const currentMode = micStateStore.getState().mode;
      if (currentMode === "DICTATION") {
        appendLiveSegment("me", text, true);
      }
    },
  });
  useEffect(() => {
    isAIProcessingRef.current = isAIProcessing;
  }, [isAIProcessing]);

  useEffect(() => {
    let unlistenDetected: (() => void) | undefined;
    let unlistenPartial: (() => void) | undefined;

    listen("speech-detected", () => {
      autoAskManagerRef.current?.cancel();
    })
      .then((u) => {
        unlistenDetected = u;
      })
      .catch(() => {});

    listen("speech-partial", () => {
      autoAskManagerRef.current?.cancel();
    })
      .then((u) => {
        unlistenPartial = u;
      })
      .catch(() => {});

    return () => {
      if (unlistenDetected) unlistenDetected();
      if (unlistenPartial) unlistenPartial();
      autoAskManagerRef.current?.cancel();
    };
  }, []);

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
      const currentMode = micStateStore.getState().mode;
      if (currentMode === "DICTATION") {
        appendLiveSegment("me", text, true);
      }
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
    resetConversation,
    setIsPopoverOpen,
    setCapturing: (val: boolean | ((prev: boolean) => boolean)) => {
      setCapturing((prev) => {
        const next = typeof val === "function" ? val(prev) : val;
        if (next) {
          if (micStateStore.getState().mode === "IDLE") {
            micStateStore.setMode("DICTATION");
          }
        } else {
          micStateStore.setMode("IDLE");
        }
        return next;
      });
    },
    setRecordingProgress,
    setIsContinuousMode,
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

  const askAIForTranscript = useCallback(
    async (utteranceId: string, text: string, source: "me" | "them") => {
      if (!isExplicitAskEligible(text)) {
        return;
      }

      if (isAIProcessing || activeAskUtteranceIdRef.current === utteranceId) {
        return;
      }

      setFillerForAnchor(utteranceId);

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
      setFillerForAnchor,
      triggerAIForQuestion,
      clearFiller,
    ]
  );
  const answerLastInterviewerUtterance = useCallback(async () => {
    if (isAIProcessing) return;

    const lastThemSegment = [...(liveSegmentsRef.current || [])]
      .reverse()
      .find((s) => s.source === "them" && !s.partial && s.text.trim());

    // Prefer what the assembler produced; fall back to the last finalised line.
    const textToAnswer =
      lastInterviewerQuestionRef.current?.trim() ||
      lastThemSegment?.text ||
      theirLastTranscription;
    if (!textToAnswer || !textToAnswer.trim()) return;
    autoAskManagerRef.current?.cancel();

    if (lastThemSegment?.id) {
      await askAIForTranscript(lastThemSegment.id, textToAnswer, "them");
    } else {
      await triggerAIForQuestion(textToAnswer, "them");
    }
  }, [
    isAIProcessing,
    theirLastTranscription,
    askAIForTranscript,
    triggerAIForQuestion,
    liveSegmentsRef,
  ]);

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
    autoAskManagerRef.current?.cancel();
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
    vadConfig,
    updateVadConfiguration,
    isContinuousMode,
    setIsContinuousMode,
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
    autoAskMode,
    setAutoAskMode,
    answerLastInterviewerUtterance,
  };
}
