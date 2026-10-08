/**
 * AI response orchestration, request abortion, throttled streaming, cooldown guard, and filler integration.
 *
 * Responsibility:
 * - Handles `processWithAI` calling `fetchAIResponse` with chunk streaming.
 * - Throttles React state flushes (80ms buffer timer) to avoid render-storming on long answers.
 * - Implements post-answer cooldown guard (2000ms) to ignore conversational backchannels/reactions.
 * - Coordinates abort controllers on new requests or stop capture.
 * - Consumes pending screenshot attachments and clears them.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { fetchAIResponse, shouldUsePluelyAPI } from "@/lib/functions";
import { getAIProviderVariables } from "@/lib/storage/ai-providers";
import { shouldTriggerAIResponse } from "@/lib/speech-filter";
import { startQuestion, recordFirstToken } from "@/lib/metrics";
import { DEFAULT_SYSTEM_PROMPT } from "@/config";
import {
  buildCodePlan,
  buildCodePlanSystemPrompt,
  buildCodeFull,
  buildCodeSystemPrompt,
} from "@/lib/code-answer";
import { getAnswerMode } from "@/lib/answer-mode";
import { THOUGHT_TRACE_PROMPT } from "@/lib/functions/ai-response.function";
import type { Message } from "@/types/completion";
import type { TYPE_PROVIDER } from "@/types";
import type { ChatMessage, ChatConversation } from "./useConversationStore";
const AI_RESPONSE_COOLDOWN_MS = 2000;

export interface SelectedAIProviderConfig {
  provider: string;
  variables: Record<string, string>;
}

export interface UseAIStreamingProps {
  selectedAIProvider: SelectedAIProviderConfig;
  allAiProviders: TYPE_PROVIDER[];
  systemPrompt: string;
  useSystemPrompt: boolean;
  contextContent: string;
  conversation: ChatConversation;
  buildHistory: (messages: ChatMessage[]) => Message[];
  addInteraction: (
    transcription: string,
    fullResponse: string,
    source?: "me" | "them"
  ) => void;
  setFillerForInterviewer: (questionText?: string) => void;
  clearFiller: () => void;
  /** Snapshot of the stall phrase for stitching (R02). Read at stream start. */
  getActiveFiller?: () => string | null;
  pendingUtteranceId?: string | null;
  pendingScreenshotRef: React.MutableRefObject<string | null>;
  setPendingScreenshot: (val: string | null) => void;
  onError: (msg: string) => void;
  /**
   * Fired once an answer finishes (or fails), after `isAIProcessing` is cleared.
   *
   * The auto-ask manager holds a question that arrived while the AI was busy;
   * this is its signal to ask it. Kept as a callback rather than letting the
   * manager poll, so the held question is asked immediately instead of at the
   * next interval.
   */
  onProcessingComplete?: () => void;
}

export function useAIStreaming({
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
  getActiveFiller,
  pendingUtteranceId,
  pendingScreenshotRef,
  setPendingScreenshot,
  onError,
  onProcessingComplete,
}: UseAIStreamingProps) {
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [lastAIResponse, setLastAIResponse] = useState<string>("");
  const [isStalled, setIsStalled] = useState(false);
  const [aiStatusMessage, setAIStatusMessage] = useState("");
  const [activeProviderId, setActiveProviderId] = useState(selectedAIProvider.provider);
  const activeProviderIdRef = useRef(selectedAIProvider.provider);
  useEffect(() => {
    setActiveProviderId(selectedAIProvider.provider);
    activeProviderIdRef.current = selectedAIProvider.provider;
  }, [selectedAIProvider.provider]);
  const lastRequestRef = useRef<{
    transcription: string;
    prompt: string;
    previousMessages: Message[];
    imagesBase64: string[];
    source?: "me" | "them";
  } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  /**
   * Which stream is current. Bumped by every `processWithAI`; an older stream
   * compares its own token before settling shared state, so aborting one to ask
   * something new cannot make the old stream clear the new one's flags.
   */
  const generationRef = useRef(0);
  const streamFlushTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const lastAIResponseAtRef = useRef<number>(0);

  const abortAI = useCallback(() => {
    generationRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    clearTimeout(streamFlushTimerRef.current);
    streamFlushTimerRef.current = undefined;
    setIsAIProcessing(false);
    setIsStalled(false);
    setAIStatusMessage("");
    clearFiller();
    // Shutdown never releases held questions into a session that is closing.
  }, [clearFiller]);

  const processWithAI = useCallback(
    async (
      transcription: string,
      prompt: string,
      previousMessages: Message[],
      imagesBase64: string[] = [],
      source?: "me" | "them",
      overrideProvider?: TYPE_PROVIDER | "pluely"
    ) => {
      generationRef.current += 1;
      const generation = generationRef.current;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const signal = controller.signal;
      const isCurrent = () => generationRef.current === generation && !signal.aborted;
      clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = undefined;
      let buffer = "";
      let fullResponse = "";
      let firstChunk = true;
      let timer: NodeJS.Timeout | undefined;
      const clearFlush = () => {
        clearTimeout(timer);
        if (isCurrent() && streamFlushTimerRef.current === timer) streamFlushTimerRef.current = undefined;
        timer = undefined;
        buffer = "";
      };
      const flush = () => {
        const snapshot = buffer;
        buffer = "";
        if (!isCurrent() || !snapshot) return;
        setLastAIResponse((prev) => isCurrent() ? prev + snapshot : prev);
      };
      setIsAIProcessing(true);
      setIsStalled(false);
      setAIStatusMessage("");
      setLastAIResponse("");
      onError("");
      const initialId = overrideProvider === "pluely" ? "pluely" : overrideProvider?.id ?? selectedAIProvider.provider;
      activeProviderIdRef.current = initialId;
      setActiveProviderId(initialId);
      lastRequestRef.current = { transcription, prompt, previousMessages, imagesBase64, source };
      try {
        const usePluelyAPI = overrideProvider === "pluely" ||
          (!overrideProvider && await shouldUsePluelyAPI());
        if (!isCurrent()) return;
        if (!selectedAIProvider.provider && !usePluelyAPI && !overrideProvider) {
          onError("No AI provider selected.");
          return;
        }
        const provider = overrideProvider === "pluely" ? undefined :
          overrideProvider || allAiProviders.find((p) => p.id === selectedAIProvider.provider);
        if (!provider && !usePluelyAPI) {
          onError("AI provider config not found.");
          return;
        }
        if (pendingScreenshotRef.current) {
          pendingScreenshotRef.current = null;
          setPendingScreenshot(null);
        }
        for await (const chunk of fetchAIResponse({
          provider: usePluelyAPI ? undefined : provider,
          selectedProvider: overrideProvider ? {
            provider: initialId,
            variables: initialId === selectedAIProvider.provider
              ? selectedAIProvider.variables : getAIProviderVariables(initialId),
          } : selectedAIProvider,
          allProviders: allAiProviders,
          systemPrompt: prompt,
          history: previousMessages,
          userMessage: transcription,
          imagesBase64,
          signal,
          mode: getAnswerMode(),
          onEvent: (event) => {
            if (!isCurrent()) return;
            activeProviderIdRef.current = event.providerId;
            setActiveProviderId(event.providerId);
            if (event.type === "restart") {
              clearFlush();
              fullResponse = "";
              firstChunk = true;
              setLastAIResponse("");
              setIsStalled(false);
              setAIStatusMessage(`Переключаю на ${event.providerId}…`);
            } else if (event.type === "stalled") {
              flush();
              setIsStalled(true);
              setAIStatusMessage(`Провайдер ${event.providerId} молчит`);
            }
          },
        })) {
          if (!isCurrent()) return;
          if (!chunk) continue;
          setIsStalled(false);
          setAIStatusMessage("");
          if (firstChunk) {
            firstChunk = false;
            recordFirstToken();
            const filler = typeof getActiveFiller === "function" ? getActiveFiller() : null;
            const stitched = filler?.trim() ? filler.trim() + "\n\n" : "";
            fullResponse += stitched;
            buffer += stitched;
            clearFiller();
          }
          fullResponse += chunk;
          buffer += chunk;
          if (!timer) {
            timer = setTimeout(() => {
              if (!isCurrent()) { timer = undefined; buffer = ""; return; }
              if (streamFlushTimerRef.current === timer) streamFlushTimerRef.current = undefined;
              timer = undefined;
              flush();
            }, 80);
            streamFlushTimerRef.current = timer;
          }
        }
        if (!isCurrent()) return;
        flush();
        if (fullResponse) {
          lastAIResponseAtRef.current = Date.now();
          addInteraction(transcription, fullResponse, source);
        }
      } catch (error) {
        if (!isCurrent()) return;
        flush();
        clearFiller();
        onError(error instanceof Error ? error.message : "Failed to get AI response");
      } finally {
        clearFlush();
        if (isCurrent()) {
          abortControllerRef.current = null;
          setIsAIProcessing(false);
          setIsStalled(false);
          setAIStatusMessage("");
          clearFiller();
          onProcessingComplete?.();
        }
      }
    },
    [selectedAIProvider, allAiProviders, onError, onProcessingComplete,
      pendingScreenshotRef, setPendingScreenshot, clearFiller, getActiveFiller, addInteraction]
  );

  // Live-coding answer, two stages (R01/R02). Bypasses filler and cooldown guards
  // when called manually or routes from auto-ask. Stage "plan" renders immediately
  // on template match, or falls back to LLM generation (instead of static dummy).
  // Stage "full" renders template snippet immediately, or streams with code prompt.
  const triggerCodeAnswer = useCallback(
    async (
      question: string,
      stage: "plan" | "full",
      source: "me" | "them" = "them"
    ) => {
      startQuestion();
      abortAI();
      const previousMessages = buildHistory(conversation.messages);
      if (stage === "plan") {
        const answer = buildCodePlan(question);
        if (answer.text) {
          setLastAIResponse(answer.text);
          lastAIResponseAtRef.current = Date.now();
          addInteraction(question, answer.text, source);
          return;
        }
        const { prompt } = buildCodePlanSystemPrompt(question);
        await processWithAI(
          question,
          prompt,
          previousMessages,
          [],
          source
        );
        return;
      }
      const full = buildCodeFull(question);
      const hasScreenshot = !!pendingScreenshotRef.current;
      // Screenshot forces the model path: a template match would otherwise
      // return early and drop the screenshot (it was captured for THIS answer).
      if (full.text && !hasScreenshot) {
        setLastAIResponse(full.text);
        lastAIResponseAtRef.current = Date.now();
        addInteraction(question, full.text, source);
        return;
      }
      const { prompt } = buildCodeSystemPrompt(question, hasScreenshot);
      await processWithAI(
        question,
        prompt,
        previousMessages,
        pendingScreenshotRef.current ? [pendingScreenshotRef.current] : [],
        source
      );
    },
    [
      buildHistory,
      abortAI,
      conversation,
      processWithAI,
      pendingScreenshotRef,
      addInteraction,
    ]
  );

  // Runs all the guards (filler/cooldown) and starts the AI response.
  // When livecode toggle is active, persistent mode routes auto-ask into code prompt.
  const triggerAIForQuestion = useCallback(
    async (question: string, source: "me" | "them") => {
      // Check if the transcription is a meaningful query/question rather than
      // a conversational filler/backchannel.
      if (!shouldTriggerAIResponse(question)) {
        console.log(
          `[Echo AI] Skipping AI processing for conversational filler/backchannel: "${question}"`
        );
        return;
      }

      // Persistent livecode toggle routes auto-ask into code prompt without manual clicks
      if (getAnswerMode() === "livecode") {
        await triggerCodeAnswer(question, "full", source);
        return;
      }

      // Cooldown guard: right after an AI answer, short utterances are usually
      // reactions to the answer, not new questions. Question starters always
      // pass through.
      const sinceLastResponse = Date.now() - lastAIResponseAtRef.current;
      const isQuestionStart =
        /^(почему|зачем|как|что|кто|где|когда|сколько|какой|какая|какие|расскажи|объясни|what|how|why|where|when|who|which|can you|could you|tell me|explain)(?=$|[^\p{L}\p{N}])/iu.test(
          question.trim()
        );
      if (
        lastAIResponseAtRef.current > 0 &&
        sinceLastResponse < AI_RESPONSE_COOLDOWN_MS &&
        question.trim().length < 60 &&
        !isQuestionStart
      ) {
        console.log(
          `[Echo AI] Skipping AI processing during post-answer cooldown (${sinceLastResponse}ms): "${question}"`
        );
        return;
      }
      startQuestion();
      // Only set generic interviewer filler if pending utterance wasn't already assigned
      // (e.g. manual askAIForTranscript already set activeFiller + pendingUtteranceId).
      // The question itself decides the language of the phrase.
      if (!pendingUtteranceId) {
        setFillerForInterviewer(question);
      }
      const mode = getAnswerMode();
      let effectiveSystemPrompt = useSystemPrompt
        ? systemPrompt || DEFAULT_SYSTEM_PROMPT
        : contextContent || DEFAULT_SYSTEM_PROMPT;

      if (mode === "thought" && !effectiveSystemPrompt.includes("THOUGHT-TRACE MODE")) {
        effectiveSystemPrompt = `${effectiveSystemPrompt}\n\n${THOUGHT_TRACE_PROMPT}`;
      }
      const previousMessages = buildHistory(conversation.messages);

      await processWithAI(
        question,
        effectiveSystemPrompt,
        previousMessages,
        pendingScreenshotRef.current ? [pendingScreenshotRef.current] : [],
        source
      );
    },
    [
      setFillerForInterviewer,
      useSystemPrompt,
      systemPrompt,
      contextContent,
      conversation,
      buildHistory,
      processWithAI,
      pendingScreenshotRef,
      clearFiller,
      triggerCodeAnswer,
    ]
  );
  const stallWait = useCallback(() => {
    setIsStalled(false);
    setAIStatusMessage("");
  }, []);

  const stallRetry = useCallback(() => {
    setIsStalled(false);
    if (lastRequestRef.current) {
      const { transcription, prompt, previousMessages, imagesBase64, source } =
        lastRequestRef.current;
      const activeId = activeProviderIdRef.current;
      const active = activeId === "pluely" ? "pluely" :
        allAiProviders.find((p) => p.id === activeId);
      void processWithAI(
        transcription, prompt, previousMessages, imagesBase64, source, active
      );
    }
  }, [processWithAI, allAiProviders]);

  const stallNext = useCallback(() => {
    if (!lastRequestRef.current || allAiProviders.length === 0) return;
    const currentIndex = allAiProviders.findIndex(
      (p) => p.id === activeProviderIdRef.current
    );
    const nextIndex =
      (currentIndex >= 0 ? currentIndex + 1 : 0) % allAiProviders.length;
    const nextProvider = allAiProviders[nextIndex];
    if (!nextProvider.id || nextProvider.id === activeProviderIdRef.current) return;
    setIsStalled(false);
    const { transcription, prompt, previousMessages, imagesBase64, source } =
      lastRequestRef.current;
    void processWithAI(
      transcription,
      prompt,
      previousMessages,
      imagesBase64,
      source,
      nextProvider
    );
  }, [allAiProviders, processWithAI]);

  const selectedIndex = allAiProviders.findIndex(
    (p) => p.id === activeProviderId
  );
  const nextIndex =
    allAiProviders.length > 0
      ? (selectedIndex >= 0 ? selectedIndex + 1 : 0) % allAiProviders.length
      : -1;
  const nextProviderId = nextIndex >= 0 ? allAiProviders[nextIndex]?.id : undefined;
  const stallNextId = nextProviderId !== activeProviderId ? nextProviderId : undefined;


  return {
    isAIProcessing,
    setIsAIProcessing,
    lastAIResponse,
    setLastAIResponse,
    processWithAI,
    triggerAIForQuestion,
    triggerCodeAnswer,
    abortAI,
    abortControllerRef,
    lastAIResponseAtRef,
    isStalled,
    aiStatusMessage,
    stallWait,
    stallRetry,
    stallNext,
    stallNextId,
    activeProviderId,
  };
}
