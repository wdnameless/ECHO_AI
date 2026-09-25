import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  AttachedFile,
  ChatMessage,
  ChatConversation,
  ScreenshotConfig,
  TYPE_PROVIDER,
  Message,
} from "@/types";
import {
  fetchAIResponse,
  shouldUsePluelyAPI,
  generateRequestId,
  generateMessageId,
  generateConversationTitle,
  getConversationById,
  saveConversation,
  MESSAGE_ID_OFFSET,
} from "@/lib";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MAX_FILES } from "@/config";

export interface BaseCompletionState {
  input: string;
  isLoading: boolean;
  error: string | null;
  attachedFiles: AttachedFile[];
}

/**
 * Converts a file to base64 data URL payload (without data prefix).
 */
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64 = (reader.result as string)?.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
  });
};

/**
 * Creates an AttachedFile representation for a captured screenshot.
 */
export const createScreenshotFile = (base64: string): AttachedFile => ({
  id: Date.now().toString(),
  name: `screenshot_${Date.now()}.png`,
  type: "image/png",
  base64,
  size: base64.length,
});

/**
 * Extracts base64 strings of all image attachments.
 */
export const extractImagesBase64 = (attachedFiles: AttachedFile[]): string[] => {
  const images: string[] = [];
  for (const file of attachedFiles) {
    if (file.type.startsWith("image/")) {
      images.push(file.base64);
    }
  }
  return images;
};

/**
 * Validates AI provider configuration or Pluely API availability.
 */
export const validateAIProvider = async (
  selectedAIProvider: { provider?: string },
  allAiProviders: TYPE_PROVIDER[]
): Promise<
  | { ok: true; provider?: TYPE_PROVIDER; usePluelyAPI: boolean }
  | { ok: false; error: string }
> => {
  const usePluelyAPI = await shouldUsePluelyAPI();
  if (!selectedAIProvider.provider && !usePluelyAPI) {
    return { ok: false, error: "Please select an AI provider in settings" };
  }
  const provider = allAiProviders.find(
    (p) => p.id === selectedAIProvider.provider
  );
  if (!provider && !usePluelyAPI) {
    return { ok: false, error: "Invalid provider selected" };
  }
  return { ok: true, provider, usePluelyAPI };
};

/**
 * Common Enter key handler for submitting text input.
 */
export const handleEnterSubmit = (
  e: React.KeyboardEvent,
  submit: () => void,
  isLoading: boolean,
  input: string
) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!isLoading && input.trim()) {
      submit();
    }
  }
};

export interface PersistConversationTurnParams {
  conversationId: string;
  lookupExistingId: string | null;
  existingMessages: ChatMessage[];
  userMessage: string;
  assistantResponse: string;
  timestamp: number;
  fallbackTitle?: string;
  fallbackCreatedAt?: number;
  preferNewTitleWhenEmpty?: boolean;
}

/**
 * Persists a user + assistant message pair into a conversation record in SQLite.
 */
export async function persistConversationTurn({
  conversationId,
  lookupExistingId,
  existingMessages,
  userMessage,
  assistantResponse,
  timestamp,
  fallbackTitle,
  fallbackCreatedAt,
  preferNewTitleWhenEmpty = false,
}: PersistConversationTurnParams): Promise<ChatConversation> {
  const userMsg: ChatMessage = {
    id: generateMessageId("user", timestamp),
    role: "user",
    content: userMessage,
    timestamp,
  };

  const assistantMsg: ChatMessage = {
    id: generateMessageId("assistant", timestamp + MESSAGE_ID_OFFSET),
    role: "assistant",
    content: assistantResponse,
    timestamp: timestamp + MESSAGE_ID_OFFSET,
  };

  const newMessages = [...existingMessages, userMsg, assistantMsg];

  let existingConversation: ChatConversation | null = null;
  if (lookupExistingId) {
    try {
      existingConversation = await getConversationById(lookupExistingId);
    } catch (error) {
      console.error("Failed to get existing conversation:", error);
    }
  }

  const title =
    preferNewTitleWhenEmpty && existingMessages.length === 0
      ? generateConversationTitle(userMessage)
      : existingConversation?.title ||
        fallbackTitle ||
        generateConversationTitle(userMessage);

  const conversation: ChatConversation = {
    id: conversationId,
    title,
    messages: newMessages,
    createdAt:
      existingConversation?.createdAt || fallbackCreatedAt || timestamp,
    updatedAt: timestamp,
  };

  await saveConversation(conversation);
  return conversation;
}

/**
 * Manages request ID generation, cancellation AbortController, and unmount cleanup.
 */
export function useCompletionRequest() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);

  const beginRequest = useCallback(() => {
    const requestId = generateRequestId();
    currentRequestIdRef.current = requestId;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    return { requestId, signal: controller.signal };
  }, []);

  const isCurrent = useCallback((requestId: string, signal?: AbortSignal) => {
    return (
      currentRequestIdRef.current === requestId &&
      (!signal || !signal.aborted)
    );
  }, []);

  const cancel = useCallback((onCancelled?: () => void) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    currentRequestIdRef.current = null;
    onCancelled?.();
  }, []);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      currentRequestIdRef.current = null;
    };
  }, []);

  return {
    abortControllerRef,
    currentRequestIdRef,
    beginRequest,
    isCurrent,
    cancel,
  };
}

export interface UseFileAttachmentsOptions {
  attachedFiles: AttachedFile[];
  setAttachedFiles: (updater: (prev: AttachedFile[]) => AttachedFile[]) => void;
  maxFiles?: number;
}

/**
 * Shared file attachment state and event handlers.
 */
export function useFileAttachments({
  attachedFiles,
  setAttachedFiles,
  maxFiles = MAX_FILES,
}: UseFileAttachmentsOptions) {
  const [isFilesPopoverOpen, setIsFilesPopoverOpen] = useState(false);

  const addFile = useCallback(
    async (file: File) => {
      try {
        const base64 = await fileToBase64(file);
        const attachedFile: AttachedFile = {
          id: Date.now().toString(),
          name: file.name,
          type: file.type,
          base64,
          size: file.size,
        };
        setAttachedFiles((prev) => [...prev, attachedFile]);
      } catch (error) {
        console.error("Failed to process file:", error);
      }
    },
    [setAttachedFiles]
  );

  const removeFile = useCallback(
    (fileId: string) => {
      setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId));
    },
    [setAttachedFiles]
  );

  const clearFiles = useCallback(() => {
    setAttachedFiles(() => []);
  }, [setAttachedFiles]);

  const onRemoveAllFiles = useCallback(() => {
    clearFiles();
    setIsFilesPopoverOpen(false);
  }, [clearFiles]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      files.forEach((file) => {
        if (
          file.type.startsWith("image/") &&
          attachedFiles.length < maxFiles
        ) {
          addFile(file);
        }
      });
      e.target.value = "";
    },
    [attachedFiles.length, maxFiles, addFile]
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const hasImages = Array.from(items).some((item) =>
        item.type.startsWith("image/")
      );

      if (hasImages) {
        e.preventDefault();
        const processedFiles: File[] = [];

        Array.from(items).forEach((item) => {
          if (
            item.type.startsWith("image/") &&
            attachedFiles.length + processedFiles.length < maxFiles
          ) {
            const file = item.getAsFile();
            if (file) {
              processedFiles.push(file);
            }
          }
        });

        await Promise.all(processedFiles.map((file) => addFile(file)));
      }
    },
    [attachedFiles.length, maxFiles, addFile]
  );

  return {
    isFilesPopoverOpen,
    setIsFilesPopoverOpen,
    addFile,
    removeFile,
    clearFiles,
    onRemoveAllFiles,
    handleFileSelect,
    handlePaste,
  };
}

/**
 * Shared completion base state operations (input setter, file attachments, request lifecycle).
 */
export function useCompletionBase<S extends BaseCompletionState>(
  state: S,
  setState: Dispatch<SetStateAction<S>>
) {
  const { beginRequest, isCurrent, cancel: cancelRequest } =
    useCompletionRequest();

  const setInput = useCallback(
    (value: string) => {
      setState((prev) => ({ ...prev, input: value }));
    },
    [setState]
  );

  const setAttachedFiles = useCallback(
    (updater: (prev: AttachedFile[]) => AttachedFile[]) => {
      setState((prev) => ({
        ...prev,
        attachedFiles: updater(prev.attachedFiles),
      }));
    },
    [setState]
  );

  const setError = useCallback(
    (error: string, stopLoading = false) => {
      setState((prev) => ({
        ...prev,
        error,
        ...(stopLoading ? { isLoading: false } : {}),
      }));
    },
    [setState]
  );

  const cancel = useCallback(() => {
    cancelRequest();
    setState((prev) => ({ ...prev, isLoading: false }));
  }, [cancelRequest, setState]);

  const fileAttachments = useFileAttachments({
    attachedFiles: state.attachedFiles,
    setAttachedFiles,
  });

  return {
    setInput,
    setAttachedFiles,
    setError,
    beginRequest,
    isCurrent,
    cancel,
    ...fileAttachments,
  };
}

export interface UseScreenshotCaptureOptions {
  screenshotConfiguration: ScreenshotConfig;
  attachedFilesCount: number;
  setAttachedFiles: (updater: (prev: AttachedFile[]) => AttachedFile[]) => void;
  onAutoPrompt: (base64: string, prompt: string) => Promise<void>;
  checkSelectionFeature?: () => { allowed: boolean; errorMessage?: string };
  logTag?: string;
  onError: (error: string, stopLoading?: boolean) => void;
}

/**
 * Handles screenshot submission, capture, macOS permission checks, and Tauri capture event listeners.
 */
export function useScreenshotCapture({
  screenshotConfiguration,
  attachedFilesCount,
  setAttachedFiles,
  onAutoPrompt,
  checkSelectionFeature,
  logTag = "[completion]",
  onError,
}: UseScreenshotCaptureOptions) {
  const [isScreenshotLoading, setIsScreenshotLoading] = useState(false);
  const isProcessingScreenshotRef = useRef(false);
  const screenshotConfigRef = useRef(screenshotConfiguration);
  const hasCheckedPermissionRef = useRef(false);
  const screenshotInitiatedByThisContext = useRef(false);

  useEffect(() => {
    screenshotConfigRef.current = screenshotConfiguration;
  }, [screenshotConfiguration]);

  const handleScreenshotSubmit = useCallback(
    async (base64: string, prompt?: string) => {
      if (attachedFilesCount >= MAX_FILES) {
        onError(`You can only upload ${MAX_FILES} files`);
        return;
      }

      try {
        if (prompt) {
          await onAutoPrompt(base64, prompt);
        } else {
          const attachedFile = createScreenshotFile(base64);
          setAttachedFiles((prev) => [...prev, attachedFile]);
        }
      } catch (error) {
        console.error("Failed to process screenshot:", error);
        onError(
          error instanceof Error
            ? error.message
            : "An error occurred processing screenshot",
          true
        );
      }
    },
    [attachedFilesCount, onAutoPrompt, setAttachedFiles, onError]
  );

  const captureScreenshot = useCallback(async () => {
    if (!handleScreenshotSubmit) return;

    const config = screenshotConfigRef.current;
    screenshotInitiatedByThisContext.current = true;
    setIsScreenshotLoading(true);

    try {
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac") && !hasCheckedPermissionRef.current) {
        // Platform-specific module only available on macOS
        const {
          checkScreenRecordingPermission,
          requestScreenRecordingPermission,
        } = await import("tauri-plugin-macos-permissions-api");

        const hasPermission = await checkScreenRecordingPermission();

        if (!hasPermission) {
          await requestScreenRecordingPermission();
          await new Promise<void>((resolve) => setTimeout(resolve, 2000));
          const hasPermissionNow = await checkScreenRecordingPermission();

          if (!hasPermissionNow) {
            onError(
              "Screen Recording permission required. Please enable it by going to System Settings > Privacy & Security > Screen & System Audio Recording. If you don't see Echo AI in the list, click the '+' button to add it. If it's already listed, make sure it's enabled. Then restart the app."
            );
            setIsScreenshotLoading(false);
            screenshotInitiatedByThisContext.current = false;
            return;
          }
        }
        hasCheckedPermissionRef.current = true;
      }

      if (config.enabled) {
        const base64 = await invoke<string>("capture_to_base64");

        if (config.mode === "auto") {
          await handleScreenshotSubmit(base64, config.autoPrompt);
        } else if (config.mode === "manual") {
          await handleScreenshotSubmit(base64);
        }
        screenshotInitiatedByThisContext.current = false;
      } else {
        if (checkSelectionFeature) {
          const check = checkSelectionFeature();
          if (!check.allowed) {
            onError(
              check.errorMessage ||
                "Режим выделения области входит в тариф Pro. Оплата пока недоступна."
            );
            setIsScreenshotLoading(false);
            screenshotInitiatedByThisContext.current = false;
            return;
          }
        }
        isProcessingScreenshotRef.current = false;
        await invoke("start_screen_capture");
      }
    } catch (error) {
      console.warn(logTag, error);
      onError("Failed to capture screenshot. Please try again.");
      isProcessingScreenshotRef.current = false;
      screenshotInitiatedByThisContext.current = false;
    } finally {
      if (config.enabled) {
        setIsScreenshotLoading(false);
      }
    }
  }, [handleScreenshotSubmit, checkSelectionFeature, logTag, onError]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      const fn = await listen<string>("captured-selection", async (event) => {
        if (!screenshotInitiatedByThisContext.current) return;
        if (isProcessingScreenshotRef.current) return;

        isProcessingScreenshotRef.current = true;
        const base64 = event.payload;
        const config = screenshotConfigRef.current;

        try {
          if (config.mode === "auto") {
            await handleScreenshotSubmit(base64, config.autoPrompt);
          } else if (config.mode === "manual") {
            await handleScreenshotSubmit(base64);
          }
        } catch (error) {
          console.error("Error processing selection:", error);
        } finally {
          setIsScreenshotLoading(false);
          screenshotInitiatedByThisContext.current = false;
          setTimeout(() => {
            isProcessingScreenshotRef.current = false;
          }, 100);
        }
      });

      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    };

    setupListener();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handleScreenshotSubmit]);

  useEffect(() => {
    const unlisten = listen("capture-closed", () => {
      setIsScreenshotLoading(false);
      isProcessingScreenshotRef.current = false;
      screenshotInitiatedByThisContext.current = false;
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return {
    isScreenshotLoading,
    setIsScreenshotLoading,
    handleScreenshotSubmit,
    captureScreenshot,
  };
}

export interface StreamAIResponseOptions {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  systemPrompt?: string;
  history: Message[];
  userMessage: string;
  imagesBase64: string[];
  signal: AbortSignal;
  isCurrent: () => boolean;
  onChunk: (chunk: string, accumulated: string) => void;
  onError: (errorMessage: string) => void;
  logTag?: string;
}

/**
 * Streams AI completion chunks, checks cancellation on each tick, and handles streaming errors.
 */
export async function streamAIResponse({
  provider,
  selectedProvider,
  systemPrompt,
  history,
  userMessage,
  imagesBase64,
  signal,
  isCurrent,
  onChunk,
  onError,
  logTag = "[completion]",
}: StreamAIResponseOptions): Promise<string | null> {
  let fullResponse = "";
  try {
    for await (const chunk of fetchAIResponse({
      provider,
      selectedProvider,
      systemPrompt: systemPrompt || undefined,
      history,
      userMessage,
      imagesBase64,
      signal,
    })) {
      if (!isCurrent() || signal.aborted) {
        return null;
      }
      fullResponse += chunk;
      onChunk(chunk, fullResponse);
    }
    return fullResponse;
  } catch (error: unknown) {
    console.warn(logTag, error);
    if (isCurrent() && !signal.aborted) {
      const message =
        error instanceof Error ? error.message : "An error occurred";
      onError(message);
    }
    return null;
  }
}
