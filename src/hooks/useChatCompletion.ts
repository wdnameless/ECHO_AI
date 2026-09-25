import { useState, useCallback, useRef } from "react";
import type {
  AttachedFile,
  ChatMessage,
  ChatConversation,
} from "@/types";
import { useApp } from "@/contexts";
import {
  getConversationById,
  generateMessageId,
  MESSAGE_ID_OFFSET,
  getResponseSettings,
} from "@/lib";
import { canUseFeature, isDevBuild } from "@/lib/entitlements";
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
      const { requestId, signal } = beginRequest();

      try {
        const messageHistory = (messages?.messages || []).map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        const providerValidation = await validateAIProvider(
          selectedAIProvider,
          allAiProviders
        );
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
          ...messages!,
          messages: [...(messages?.messages || []), userMsg],
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
          systemPrompt: systemPrompt || undefined,
          history: messageHistory,
          userMessage: userText,
          imagesBase64,
          signal,
          isCurrent: () => isCurrent(requestId, signal),
          onChunk: (_chunk, accumulated) => {
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
            setError(errorMessage, true);
          },
          logTag: "[chat-completion]",
        });

        if (fullResponse === null || !isCurrent(requestId, signal)) {
          return;
        }

        setState((prev) => ({ ...prev, isLoading: false }));

        if (options.focusInputOnComplete) {
          setTimeout(() => {
            inputRef.current?.focus();
          }, 100);
        }

        if (fullResponse) {
          try {
            await persistConversationTurn({
              conversationId,
              lookupExistingId: conversationId || null,
              existingMessages: messages?.messages || [],
              userMessage: userText,
              assistantResponse: fullResponse,
              timestamp,
              fallbackTitle: messages?.title,
              fallbackCreatedAt: messages?.createdAt,
              preferNewTitleWhenEmpty: false,
            });

            if (conversationId) {
              const updatedConversation = await getConversationById(
                conversationId
              );
              if (updatedConversation) {
                setMessages(updatedConversation);
              }
            }
          } catch (error) {
            console.error("Failed to save conversation:", error);
            if (options.focusInputOnComplete) {
              setError("Failed to save conversation. Please try again.");
            }
          }
        }
      } catch (error) {
        console.warn("[chat-completion]", error);
        if (isCurrent(requestId, signal)) {
          setError(
            error instanceof Error ? error.message : "An error occurred",
            true
          );
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
    checkSelectionFeature: () => {
      const allowed = canUseFeature("selectionMode", {
        isDevBuild: isDevBuild(),
        hasLicense: hasActiveLicense,
      });
      return {
        allowed,
        errorMessage: allowed
          ? undefined
          : "Режим выделения области входит в тариф Pro. Оплата пока недоступна.",
      };
    },
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
