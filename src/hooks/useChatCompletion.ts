import { useState, useCallback, useRef, useLayoutEffect, useEffect } from "react";
import type {
  AttachedFile,
  ChatMessage,
  ChatConversation,
} from "@/types";
import { useApp } from "@/contexts";
import {
  getConversationById,
  generateMessageId,
  generateConversationId,
  MESSAGE_ID_OFFSET,
  getResponseSettings,
} from "@/lib";
import {
  useCompletionBase,
  useScreenshotCapture,
  validateAIProvider,
  extractImagesBase64,
  handleEnterSubmit,
  streamAIResponse,
  persistConversationTurn,
} from "./useCompletionCommon";

interface ChatCompletionState {
  input: string;
  isLoading: boolean;
  error: string | null;
  attachedFiles: AttachedFile[];
}

export const useChatCompletion = (
  conversationId: string,
  messages: ChatConversation | null,
  setMessages: (messages: ChatConversation | null) => void
) => {
  const {
    selectedAIProvider,
    allAiProviders,
    systemPrompt,
    screenshotConfiguration,
    setScreenshotConfiguration,
    selectedSttProvider,
    allSttProviders,
    selectedAudioDevices,
    hasActiveLicense,
  } = useApp();

  const [state, setState] = useState<ChatCompletionState>({
    input: "",
    isLoading: false,
    error: null,
    attachedFiles: [],
  });

  const [micOpen, setMicOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef<string>(conversationId);
  const pendingSaveRef = useRef<Promise<ChatConversation> | null>(null);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);
  const {
    setInput,
    setAttachedFiles,
    setError,
    beginRequest,
    isCurrent,
    cancel,
    isFilesPopoverOpen,
    setIsFilesPopoverOpen,
    addFile,
    removeFile,
    clearFiles,
    onRemoveAllFiles,
    handleFileSelect,
    handlePaste,
  } = useCompletionBase(state, setState);

  useLayoutEffect(() => {
    cancel();
  }, [conversationId, cancel]);

  const scrollToBottom = () => {
    const responseSettings = getResponseSettings();
    if (responseSettings.autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };

  const runChatTurn = useCallback(
    async (
      userText: string,
      imagesBase64: string[],
      options: { focusInputOnComplete: boolean }
    ) => {
      let targetConversationId = conversationId;
      if (!targetConversationId) {
        targetConversationId =
          conversationIdRef.current || generateConversationId("chat");
        conversationIdRef.current = targetConversationId;
      }
      const activeConversationId = targetConversationId;
      const activeMessages = messages;
      const { requestId, signal, generation } = beginRequest();

      try {
        const messageHistory = (activeMessages?.messages || []).map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        const providerValidation = await validateAIProvider(
          selectedAIProvider,
          allAiProviders
        );

        // Guard post-validation await before mutating state
        if (!isCurrent(requestId, signal, generation)) {
          return;
        }

        if (!providerValidation.ok) {
          setError(providerValidation.error);
          return;
        }

        const timestamp = Date.now();
        const userMsg: ChatMessage = {
          id: generateMessageId("user", timestamp),
          role: "user",
          content: userText,
          timestamp,
        };

        const updatedMessages = {
          ...activeMessages!,
          messages: [...(activeMessages?.messages || []), userMsg],
        };
        setMessages(updatedMessages);

        setState((prev) => ({
          ...prev,
          input: "",
          isLoading: true,
          error: null,
          attachedFiles: [],
        }));

        setTimeout(scrollToBottom, 100);

        const fullResponse = await streamAIResponse({
          provider: providerValidation.usePluelyAPI
            ? undefined
            : providerValidation.provider,
          selectedProvider: selectedAIProvider,
          allProviders: allAiProviders,
          systemPrompt: systemPrompt || undefined,
          history: messageHistory,
          userMessage: userText,
          imagesBase64,
          signal,
          isCurrent: () => isCurrent(requestId, signal, generation),
          onChunk: (_chunk, accumulated) => {
            if (!isCurrent(requestId, signal, generation)) {
              return;
            }

            const assistantMsg: ChatMessage = {
              id: generateMessageId(
                 "assistant",
                 timestamp + MESSAGE_ID_OFFSET
               ),
               role: "assistant",
               content: accumulated,
               timestamp: timestamp + MESSAGE_ID_OFFSET,
             };

             const updatedWithResponse = {
               ...updatedMessages,
               messages: [...updatedMessages.messages, assistantMsg],
             };

             const lastMessage =
               updatedWithResponse.messages[
                 updatedWithResponse.messages.length - 1
               ];
             if (lastMessage.role === "assistant") {
               updatedWithResponse.messages[
                 updatedWithResponse.messages.length - 1
               ] = assistantMsg;
             } else {
               updatedWithResponse.messages.push(assistantMsg);
             }

             setMessages(updatedWithResponse);
             scrollToBottom();
           },
           onError: (errorMessage) => {
            if (!isCurrent(requestId, signal, generation)) {
              return;
            }
             setError(errorMessage, true);
           },
           logTag: "[chat-completion]",
         });

        if (fullResponse === null) {
          if (isCurrent(requestId, signal, generation)) {
            setState((prev) => ({ ...prev, isLoading: false }));
          }
          return;
        }

        if (fullResponse) {
          if (pendingSaveRef.current) {
            try {
              await pendingSaveRef.current;
            } catch {
              // Allow subsequent turn to proceed even if previous save failed
            }
          }

          const savePromise = persistConversationTurn({
            conversationId: activeConversationId,
            lookupExistingId: activeConversationId || null,
            existingMessages: activeMessages?.messages || [],
            userMessage: userText,
            assistantResponse: fullResponse,
            timestamp,
            fallbackTitle: activeMessages?.title,
            fallbackCreatedAt: activeMessages?.createdAt,
            preferNewTitleWhenEmpty: false,
          });
          pendingSaveRef.current = savePromise;

          try {
            // Legitimate save of completed old chat is preserved
            const conversation = await savePromise;

            let updatedConversation: ChatConversation | null = null;
            if (activeConversationId) {
              try {
                updatedConversation = await getConversationById(
                  activeConversationId
                );
              } catch (err) {
                console.error("Failed to fetch updated conversation:", err);
              }
            }

            // Guard post-persist/read awaits before mutating state
            if (isCurrent(requestId, signal, generation)) {
              if (updatedConversation) {
                setMessages(updatedConversation);
              } else if (conversation) {
                setMessages(conversation);
              }

              setState((prev) => ({ ...prev, isLoading: false }));

              if (options.focusInputOnComplete) {
                setTimeout(() => {
                  inputRef.current?.focus();
                }, 100);
              }
            }
          } catch (error) {
            console.error("Failed to save conversation:", error);
            if (isCurrent(requestId, signal, generation)) {
              setState((prev) => ({
                ...prev,
                isLoading: false,
                input: userText,
              }));
              setError("Failed to save conversation. Please try again.");
            }
          } finally {
            if (pendingSaveRef.current === savePromise) {
              pendingSaveRef.current = null;
            }
          }
        } else {
          if (isCurrent(requestId, signal, generation)) {
            setState((prev) => ({ ...prev, isLoading: false }));
          }
        }
      } catch (error) {
        console.warn("[chat-completion]", error);
        if (isCurrent(requestId, signal, generation)) {
          setError(
            error instanceof Error ? error.message : "An error occurred",
            true
          );
          setState((prev) => ({ ...prev, isLoading: false }));
        }
      }
    },
    [
      messages,
      selectedAIProvider,
      allAiProviders,
      systemPrompt,
      conversationId,
      setMessages,
      beginRequest,
      isCurrent,
      setError,
    ]
  );

  const submit = useCallback(
    async (speechText?: string) => {
      const input = speechText || state.input;
      if (!input.trim()) {
        return;
      }
      if (speechText) {
        setInput(speechText);
      }
      const imagesBase64 = extractImagesBase64(state.attachedFiles);
      await runChatTurn(input, imagesBase64, { focusInputOnComplete: true });
    },
    [state.input, state.attachedFiles, setInput, runChatTurn]
  );

  const onAutoScreenshotPrompt = useCallback(
    async (base64: string, prompt: string) => {
      await runChatTurn(prompt, [base64], { focusInputOnComplete: false });
    },
    [runChatTurn]
  );

  const {
    isScreenshotLoading,
    captureScreenshot,
    handleScreenshotSubmit,
  } = useScreenshotCapture({
    screenshotConfiguration,
    attachedFilesCount: state.attachedFiles.length,
    setAttachedFiles,
    onAutoPrompt: onAutoScreenshotPrompt,
    logTag: "[chat-completion]",
    onError: setError,
  });

  const handleKeyPress = (e: React.KeyboardEvent) => {
    handleEnterSubmit(e, submit, state.isLoading, state.input);
  };

  return {
    input: state.input,
    setInput,
    isLoading: state.isLoading,
    error: state.error,
    attachedFiles: state.attachedFiles,
    addFile,
    removeFile,
    clearFiles,
    submit,
    cancel,
    setState,
    isRecording,
    setIsRecording,
    micOpen,
    setMicOpen,
    screenshotConfiguration,
    setScreenshotConfiguration,
    handleScreenshotSubmit,
    handleFileSelect,
    handleKeyPress,
    handlePaste,
    isFilesPopoverOpen,
    setIsFilesPopoverOpen,
    onRemoveAllFiles,
    inputRef,
    captureScreenshot,
    isScreenshotLoading,
    messagesEndRef,
    selectedSttProvider,
    allSttProviders,
    selectedAudioDevices,
    hasActiveLicense,
  };
};
