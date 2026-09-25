import { useState, useCallback, useRef, useEffect } from "react";
import type {
  ChatConversation,
  CompletionState,
} from "@/types";
import { toChronologicalMessages } from "./useConversationStore";
import { useWindowResize } from "./useWindow";
import { useGlobalShortcuts } from "@/hooks";
import { useApp } from "@/contexts";
import {
  getConversationById,
  generateConversationId,
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

export const useCompletion = () => {
  const {
    selectedAIProvider,
    allAiProviders,
    systemPrompt,
    screenshotConfiguration,
    setScreenshotConfiguration,
  } = useApp();
  const globalShortcuts = useGlobalShortcuts();

  const [state, setState] = useState<CompletionState>({
    input: "",
    response: "",
    isLoading: false,
    error: null,
    attachedFiles: [],
    currentConversationId: null,
    conversationHistory: [],
  });
  const [micOpen, setMicOpen] = useState(false);
  const [enableVAD, setEnableVAD] = useState(false);
  const [messageHistoryOpen, setMessageHistoryOpen] = useState(false);
  const [keepEngaged, setKeepEngaged] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const { resizeWindow } = useWindowResize();

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

  const setResponse = useCallback((value: string) => {
    setState((prev) => ({ ...prev, response: value }));
  }, []);

  const loadConversation = useCallback((conversation: ChatConversation) => {
    setState((prev) => ({
      ...prev,
      currentConversationId: conversation.id,
      conversationHistory: conversation.messages,
      input: "",
      response: "",
      error: null,
      isLoading: false,
    }));
  }, []);

  const startNewConversation = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentConversationId: null,
      conversationHistory: [],
      input: "",
      response: "",
      error: null,
      isLoading: false,
      attachedFiles: [],
    }));
  }, []);

  const saveCurrentConversation = useCallback(
    async (userMessage: string, assistantResponse: string) => {
      if (!userMessage || !assistantResponse) {
        console.error("Cannot save conversation: missing message content");
        return;
      }

      const conversationId =
        state.currentConversationId || generateConversationId("chat");
      const timestamp = Date.now();

      try {
        const conversation = await persistConversationTurn({
          conversationId,
          lookupExistingId: state.currentConversationId,
          existingMessages: state.conversationHistory,
          userMessage,
          assistantResponse,
          timestamp,
          preferNewTitleWhenEmpty: true,
        });

        setState((prev) => ({
          ...prev,
          currentConversationId: conversation.id,
          conversationHistory: conversation.messages,
        }));
      } catch (error) {
        console.error("Failed to save conversation:", error);
        setError("Failed to save conversation. Please try again.");
      }
    },
    [state.currentConversationId, state.conversationHistory, setError]
  );

  const runCompletionTurn = useCallback(
    async (
      userMessage: string,
      imagesBase64: string[],
      clearAttachedOnSuccess: boolean,
      setPromptAsInput: boolean
    ) => {
      const { requestId, signal } = beginRequest();

      try {
        const messageHistory = toChronologicalMessages(
          state.conversationHistory
        ).map((msg) => ({
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

        setState((prev) => ({
          ...prev,
          ...(setPromptAsInput ? { input: userMessage } : {}),
          isLoading: true,
          error: null,
          response: "",
        }));

        const fullResponse = await streamAIResponse({
          provider: providerValidation.usePluelyAPI
            ? undefined
            : providerValidation.provider,
          selectedProvider: selectedAIProvider,
          systemPrompt: systemPrompt || undefined,
          history: messageHistory,
          userMessage,
          imagesBase64,
          signal,
          isCurrent: () => isCurrent(requestId, signal),
          onChunk: (chunk) => {
            setState((prev) => ({
              ...prev,
              response: prev.response + chunk,
            }));
          },
          onError: (errorMessage) => {
            setError(errorMessage, true);
          },
          logTag: "[completion]",
        });

        if (isCurrent(requestId, signal)) {
          setState((prev) => ({ ...prev, isLoading: false }));
        }

        if (fullResponse === null || !isCurrent(requestId, signal)) {
          return;
        }

        setTimeout(() => {
          inputRef.current?.focus();
        }, 100);

        if (fullResponse) {
          await saveCurrentConversation(userMessage, fullResponse);
          setState((prev) => ({
            ...prev,
            input: "",
            ...(clearAttachedOnSuccess ? { attachedFiles: [] } : {}),
          }));
        }
      } catch (error) {
        console.warn("[completion]", error);
        if (isCurrent(requestId, signal)) {
          setError(
            error instanceof Error ? error.message : "An error occurred",
            true
          );
        }
      }
    },
    [
      state.conversationHistory,
      selectedAIProvider,
      allAiProviders,
      systemPrompt,
      beginRequest,
      isCurrent,
      setError,
      saveCurrentConversation,
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
      await runCompletionTurn(input, imagesBase64, true, false);
    },
    [state.input, state.attachedFiles, setInput, runCompletionTurn]
  );

  const reset = useCallback(() => {
    if (keepEngaged) {
      return;
    }
    cancel();
    setState((prev) => ({
      ...prev,
      input: "",
      response: "",
      error: null,
      attachedFiles: [],
    }));
  }, [cancel, keepEngaged]);

  const onAutoScreenshotPrompt = useCallback(
    async (base64: string, prompt: string) => {
      await runCompletionTurn(prompt, [base64], false, true);
    },
    [runCompletionTurn]
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
    logTag: "[completion]",
    onError: setError,
  });

  const handleKeyPress = (e: React.KeyboardEvent) => {
    handleEnterSubmit(e, submit, state.isLoading, state.input);
  };

  useEffect(() => {
    const handleConversationSelected = async (event: Event) => {
      const customEvent = event as CustomEvent<{ id?: string }>;
      const id = customEvent.detail?.id;
      if (!id || typeof id !== "string") {
        console.error("No conversation ID provided");
        setError("Invalid conversation selected");
        return;
      }
      try {
        const conversation = await getConversationById(id);
        if (conversation) {
          loadConversation(conversation);
        } else {
          console.error(`Conversation ${id} not found in database`);
          setError("Conversation not found. It may have been deleted.");
        }
      } catch (error) {
        console.error("Failed to load conversation:", error);
        setError("Failed to load conversation. Please try again.");
      }
    };

    const handleNewConversation = () => {
      startNewConversation();
    };

    const handleConversationDeleted = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      const deletedId = customEvent.detail;
      if (state.currentConversationId === deletedId) {
        startNewConversation();
      }
    };

    const handleStorageChange = async (e: StorageEvent) => {
      if (e.key === "pluely-conversation-selected" && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          const { id } = data;
          if (id && typeof id === "string") {
            const conversation = await getConversationById(id);
            if (conversation) {
              loadConversation(conversation);
            }
          }
        } catch (error) {
          console.error("Failed to parse conversation selection:", error);
        }
      }
    };

    window.addEventListener("conversationSelected", handleConversationSelected);
    window.addEventListener("newConversation", handleNewConversation);
    window.addEventListener("conversationDeleted", handleConversationDeleted);
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener(
        "conversationSelected",
        handleConversationSelected
      );
      window.removeEventListener("newConversation", handleNewConversation);
      window.removeEventListener(
        "conversationDeleted",
        handleConversationDeleted
      );
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [loadConversation, startNewConversation, state.currentConversationId, setError]);

  const isPopoverOpen =
    state.isLoading ||
    state.response !== "" ||
    state.error !== null ||
    keepEngaged;

  useEffect(() => {
    resizeWindow(
      isPopoverOpen || micOpen || messageHistoryOpen || isFilesPopoverOpen
    );
  }, [
    isPopoverOpen,
    micOpen,
    messageHistoryOpen,
    resizeWindow,
    isFilesPopoverOpen,
  ]);

  useEffect(() => {
    const responseSettings = getResponseSettings();
    if (
      !keepEngaged &&
      state.response &&
      scrollAreaRef.current &&
      responseSettings.autoScroll
    ) {
      const scrollElement = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollElement) {
        scrollElement.scrollTo({
          top: scrollElement.scrollHeight,
          behavior: "smooth",
        });
      }
    }
  }, [state.response, keepEngaged]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      const activeScrollRef = scrollAreaRef.current;
      const scrollElement = activeScrollRef?.querySelector(
        "[data-radix-scroll-area-viewport]"
      ) as HTMLElement | null;

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
  }, [isPopoverOpen]);

  useEffect(() => {
    const handleToggleShortcut = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setKeepEngaged((prev) => !prev);
        setTimeout(() => {
          inputRef.current?.focus();
        }, 100);
      }
    };

    window.addEventListener("keydown", handleToggleShortcut);
    return () => window.removeEventListener("keydown", handleToggleShortcut);
  }, [isPopoverOpen]);

  const toggleRecording = useCallback(() => {
    setEnableVAD(!enableVAD);
    setMicOpen(!micOpen);
  }, [enableVAD, micOpen]);

  useEffect(() => {
    globalShortcuts.registerAudioCallback(toggleRecording);
    globalShortcuts.registerInputRef(inputRef.current);
    globalShortcuts.registerScreenshotCallback(captureScreenshot);
  }, [
    globalShortcuts,
    toggleRecording,
    captureScreenshot,
  ]);

  return {
    input: state.input,
    setInput,
    response: state.response,
    setResponse,
    isLoading: state.isLoading,
    error: state.error,
    attachedFiles: state.attachedFiles,
    addFile,
    removeFile,
    clearFiles,
    submit,
    cancel,
    reset,
    setState,
    enableVAD,
    setEnableVAD,
    micOpen,
    setMicOpen,
    currentConversationId: state.currentConversationId,
    conversationHistory: state.conversationHistory,
    loadConversation,
    startNewConversation,
    messageHistoryOpen,
    setMessageHistoryOpen,
    screenshotConfiguration,
    setScreenshotConfiguration,
    handleScreenshotSubmit,
    handleFileSelect,
    handleKeyPress,
    handlePaste,
    isPopoverOpen,
    scrollAreaRef,
    resizeWindow,
    isFilesPopoverOpen,
    setIsFilesPopoverOpen,
    onRemoveAllFiles,
    inputRef,
    captureScreenshot,
    isScreenshotLoading,
    keepEngaged,
    setKeepEngaged,
  };
};
