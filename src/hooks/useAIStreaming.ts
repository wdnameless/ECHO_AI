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

import { useState, useRef, useCallback } from "react";
import { fetchAIResponse, shouldUsePluelyAPI } from "@/lib/functions";
import { shouldTriggerAIResponse } from "@/lib/speech-filter";
import { startQuestion, recordFirstToken } from "@/lib/metrics";
import { DEFAULT_SYSTEM_PROMPT } from "@/config";
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
  pendingUtteranceId,
  pendingScreenshotRef,
  setPendingScreenshot,
  onError,
  onProcessingComplete,
}: UseAIStreamingProps) {
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [lastAIResponse, setLastAIResponse] = useState<string>("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamBufferRef = useRef<string>("");
  const streamFlushTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastAIResponseAtRef = useRef<number>(0);

  const abortAI = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    clearFiller();
  }, [clearFiller]);

  const processWithAI = useCallback(
    async (
      transcription: string,
      prompt: string,
      previousMessages: Message[],
      imagesBase64: string[] = [],
      source?: "me" | "them"
    ) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      try {
        setIsAIProcessing(true);
        setLastAIResponse("");
        onError("");
        let fullResponse = "";

        const usePluelyAPI = await shouldUsePluelyAPI();
        if (!selectedAIProvider.provider && !usePluelyAPI) {
          onError("No AI provider selected.");
          return;
        }

        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        if (!provider && !usePluelyAPI) {
          onError("AI provider config not found.");
          return;
        }

        // The pending screenshot is now part of this request
        if (pendingScreenshotRef.current) {
          pendingScreenshotRef.current = null;
          setPendingScreenshot(null);
        }

        try {
          let isFirstChunk = true;
          for await (const chunk of fetchAIResponse({
            provider: usePluelyAPI ? undefined : provider,
            selectedProvider: selectedAIProvider,
            systemPrompt: prompt,
            history: previousMessages,
            userMessage: transcription,
            imagesBase64,
            signal: abortControllerRef.current.signal,
          })) {
            if (isFirstChunk) {
              isFirstChunk = false;
              recordFirstToken();
              clearFiller();
            }
            fullResponse += chunk;
            // Throttled flush: buffer chunks, update React state at most
            // every 80ms to keep the UI smooth on long answers.
            streamBufferRef.current += chunk;
            if (!streamFlushTimerRef.current) {
              streamFlushTimerRef.current = setTimeout(() => {
                streamFlushTimerRef.current = null;
                const buffered = streamBufferRef.current;
                streamBufferRef.current = "";
                if (buffered) {
                  setLastAIResponse((prev) => prev + buffered);
                }
              }, 80);
            }
          }
          // Final flush of any remaining buffered chunks.
          if (streamFlushTimerRef.current) {
            clearTimeout(streamFlushTimerRef.current);
            streamFlushTimerRef.current = null;
          }
          if (streamBufferRef.current) {
            setLastAIResponse((prev) => prev + streamBufferRef.current);
            streamBufferRef.current = "";
          }
        } catch (aiError: unknown) {
          console.warn("[ai-stream]", aiError);
          clearFiller();
          const err = aiError as { message?: string };
          onError(err?.message || "Failed to get AI response");
        }
        if (fullResponse) {
          lastAIResponseAtRef.current = Date.now();
          addInteraction(transcription, fullResponse, source);
        }
      } catch (err: unknown) {
        console.warn("[ai-stream]", err);
        clearFiller();
      } finally {
        setIsAIProcessing(false);
        clearFiller();
        // After the flag is cleared, so a question held during the answer sees
        // `isAIProcessing === false` and goes out immediately.
        onProcessingComplete?.();
      }
    },
    [
      selectedAIProvider,
      allAiProviders,
      onError,
      onProcessingComplete,
      pendingScreenshotRef,
      setPendingScreenshot,
      clearFiller,
      addInteraction,
    ]
  );

  // Runs all the guards (filler/cooldown) and starts the AI response.
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
      const effectiveSystemPrompt = useSystemPrompt
        ? systemPrompt || DEFAULT_SYSTEM_PROMPT
        : contextContent || DEFAULT_SYSTEM_PROMPT;

      const previousMessages = buildHistory(conversation.messages);

      try {
        await processWithAI(
          question,
          effectiveSystemPrompt,
          previousMessages,
          pendingScreenshotRef.current ? [pendingScreenshotRef.current] : [],
          source
        );
      } finally {
        clearFiller();
      }
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
    ]
  );

  return {
    isAIProcessing,
    setIsAIProcessing,
    lastAIResponse,
    setLastAIResponse,
    processWithAI,
    triggerAIForQuestion,
    abortAI,
    abortControllerRef,
    lastAIResponseAtRef,
  };
}
