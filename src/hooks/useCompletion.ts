import { useState, useCallback, useRef, useEffect } from "react";
import type {
  ChatConversation,
  ChatMessage,
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
  const conversationIdRef = useRef<string | null>(null);
  const pendingSaveRef = useRef<Promise<ChatConversation> | null>(null);
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

  const loadConversation = useCallback(
    (conversation: ChatConversation) => {
      conversationIdRef.current = conversation.id;
      cancel();
      setState((prev) => ({
        ...prev,
        currentConversationId: conversation.id,
        conversationHistory: conversation.messages,
        input: "",
        response: "",
        error: null,
        isLoading: false,
      }));
    },
    [cancel]
  );

  const startNewConversation = useCallback(() => {
    conversationIdRef.current = null;
    cancel();
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
  }, [cancel]);

  useEffect(() => {
    conversationIdRef.current = state.currentConversationId;
  }, [state.currentConversationId]);

  const saveCurrentConversation = useCallback(
    async (
      userMessage: string,
      assistantResponse: string,
      targetConversationId: string,
      targetHistory: ChatMessage[],
      requestId: string,
      signal: AbortSignal,
      generation: number
    ): Promise<boolean> => {
      if (!userMessage || !assistantResponse) {
        console.error("Cannot save conversation: missing message content");
        return false;
      }

      if (pendingSaveRef.current) {
        try {
          await pendingSaveRef.current;
        } catch {
          // Allow subsequent save to proceed even if earlier failed
        }
      }

      const timestamp = Date.now();
      const savePromise = persistConversationTurn({
        conversationId: targetConversationId,
        lookupExistingId: targetConversationId,
        existingMessages: targetHistory,
        userMessage,
        assistantResponse,
        timestamp,
        preferNewTitleWhenEmpty: true,
      });
      pendingSaveRef.current = savePromise;

      try {
        const conversation = await savePromise;

        // Guard post-persist await before mutating state
        if (isCurrent(requestId, signal, generation)) {
          conversationIdRef.current = conversation.id;
          setState((prev) => ({
            ...prev,
            currentConversationId: conversation.id,
            conversationHistory: conversation.messages,
          }));
        }
        return true;
      } catch (error) {
        console.error("Failed to save conversation:", error);
        if (isCurrent(requestId, signal, generation)) {
          setError("Failed to save conversation. Please try again.");
        }
        return false;
      } finally {
        if (pendingSaveRef.current === savePromise) {
          pendingSaveRef.current = null;
        }
      }
    },
    [isCurrent, setError]
  );

  const runCompletionTurn = useCallback(
    async (
      userMessage: string,
      imagesBase64: string[],
      clearAttachedOnSuccess: boolean,
      setPromptAsInput: boolean
    ) => {
      let activeConversationId =
        conversationIdRef.current || state.currentConversationId;
      if (!activeConversationId) {
        activeConversationId = generateConversationId("chat");
        conversationIdRef.current = activeConversationId;
      }
      const activeHistory = state.conversationHistory;
      const { requestId, signal, generation } = beginRequest();

      try {
        const messageHistory = toChronologicalMessages(
          activeHistory
        ).map((msg) => ({
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
          allProviders: allAiProviders,
          systemPrompt: systemPrompt || undefined,
          history: messageHistory,
          userMessage,
          imagesBase64,
          signal,
          isCurrent: () => isCurrent(requestId, signal, generation),
          onChunk: (_chunk, accumulated) => {
            if (isCurrent(requestId, signal, generation)) {
              setState((prev) => ({
                ...prev,
                response: accumulated,
              }));
            }
          },
          onError: (errorMessage) => {
            if (isCurrent(requestId, signal, generation)) {
              setError(errorMessage, true);
            }
          },
          logTag: "[completion]",
        });

        if (fullResponse === null) {
          if (isCurrent(requestId, signal, generation)) {
            setState((prev) => ({ ...prev, isLoading: false }));
          }
          return;
        }

        if (fullResponse) {
          // Legitimate save of completed old chat is preserved
          const saved = await saveCurrentConversation(
            userMessage,
            fullResponse,
            activeConversationId,
            activeHistory,
            requestId,
            signal,
            generation
          );

          // Guard post-persist await before mutating state
          if (isCurrent(requestId, signal, generation)) {
            setState((prev) => ({
              ...prev,
              isLoading: false,
              ...(saved
                ? {
                    input: "",
                    ...(clearAttachedOnSuccess ? { attachedFiles: [] } : {}),
                  }
                : {}),
            }));

            if (saved) {
              setTimeout(() => {
                inputRef.current?.focus();
              }, 100);
            }
          }
        } else {
          if (isCurrent(requestId, signal, generation)) {
            setState((prev) => ({ ...prev, isLoading: false }));
          }
        }
      } catch (error) {
        console.warn("[completion]", error);
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
      state.currentConversationId,
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
    conversationIdRef.current = state.currentConversationId;
    setState((prev) => ({
      ...prev,
      input: "",
      response: "",
      error: null,
      attachedFiles: [],
    }));
  }, [cancel, keepEngaged, state.currentConversationId]);

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
