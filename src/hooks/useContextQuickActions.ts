/**
 * UI Context and Quick Actions state and persistence hook.
 *
 * Responsibility:
 * - Manages system audio context prompt settings (useSystemPrompt, content, respondToMic).
 * - Manages user configurable quick actions list and editor modal state.
 * - Handles persistence of quick actions and context settings to safeLocalStorage.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { safeLocalStorage } from "@/lib";
import { DEFAULT_QUICK_ACTIONS, STORAGE_KEYS } from "@/config";

export function useContextQuickActions() {
  const [quickActions, setQuickActions] = useState<string[]>([]);
  const [isManagingQuickActions, setIsManagingQuickActions] =
    useState<boolean>(false);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(true);

  const [useSystemPrompt, setUseSystemPrompt] = useState<boolean>(true);
  const [contextContent, setContextContent] = useState<string>("");
  const [respondToMic, setRespondToMic] = useState<boolean>(() => {
    return safeLocalStorage.getItem("respond_to_mic") === "true";
  });
  const respondToMicRef = useRef<boolean>(respondToMic);

  useEffect(() => {
    respondToMicRef.current = respondToMic;
  }, [respondToMic]);

  useEffect(() => {
    const savedContext = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT
    );
    if (savedContext) {
      try {
        const parsed = JSON.parse(savedContext);
        setUseSystemPrompt(parsed.useSystemPrompt ?? true);
        setContextContent(parsed.contextContent ?? "");
      } catch (err) {
        console.error("Failed to load system audio context:", err);
      }
    }
  }, []);

  useEffect(() => {
    const savedActions = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS
    );
    if (savedActions) {
      try {
        const parsed = JSON.parse(savedActions);
        setQuickActions(parsed);
      } catch (err) {
        console.error("Failed to load quick actions:", err);
        setQuickActions(DEFAULT_QUICK_ACTIONS);
      }
    } else {
      setQuickActions(DEFAULT_QUICK_ACTIONS);
    }
  }, []);

  const saveContextSettings = useCallback(
    (usePrompt: boolean, content: string) => {
      try {
        const contextSettings = {
          useSystemPrompt: usePrompt,
          contextContent: content,
        };
        safeLocalStorage.setItem(
          STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT,
          JSON.stringify(contextSettings)
        );
      } catch (err) {
        console.error("Failed to save context settings:", err);
      }
    },
    []
  );

  const updateUseSystemPrompt = useCallback(
    (value: boolean) => {
      setUseSystemPrompt(value);
      saveContextSettings(value, contextContent);
    },
    [contextContent, saveContextSettings]
  );

  const updateContextContent = useCallback(
    (content: string) => {
      setContextContent(content);
      saveContextSettings(useSystemPrompt, content);
    },
    [useSystemPrompt, saveContextSettings]
  );

  const updateRespondToMic = useCallback((value: boolean) => {
    setRespondToMic(value);
    safeLocalStorage.setItem("respond_to_mic", String(value));
  }, []);

  const saveQuickActions = useCallback((actions: string[]) => {
    try {
      safeLocalStorage.setItem(
        STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS,
        JSON.stringify(actions)
      );
    } catch (err) {
      console.error("Failed to save quick actions:", err);
    }
  }, []);

  const addQuickAction = useCallback(
    (action: string) => {
      if (action && !quickActions.includes(action)) {
        const newActions = [...quickActions, action];
        setQuickActions(newActions);
        saveQuickActions(newActions);
      }
    },
    [quickActions, saveQuickActions]
  );

  const removeQuickAction = useCallback(
    (action: string) => {
      const newActions = quickActions.filter((a) => a !== action);
      setQuickActions(newActions);
      saveQuickActions(newActions);
    },
    [quickActions, saveQuickActions]
  );

  return {
    quickActions,
    setQuickActions,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    useSystemPrompt,
    setUseSystemPrompt: updateUseSystemPrompt,
    setRawUseSystemPrompt: setUseSystemPrompt,
    contextContent,
    setContextContent: updateContextContent,
    setRawContextContent: setContextContent,
    respondToMic,
    setRespondToMic: updateRespondToMic,
    respondToMicRef,
    addQuickAction,
    removeQuickAction,
  };
}
