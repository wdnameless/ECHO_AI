/**
 * System-audio context settings.
 *
 * Responsibility:
 * - Holds the prompt/context switches the copilot panel exposes (useSystemPrompt,
 *   contextContent, respondToMic) and persists them to safeLocalStorage.
 *
 * The user-editable quick-action list used to live here too; it was removed with
 * its panel, so this module is now only about the audio context.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { safeLocalStorage } from "@/lib";
import { STORAGE_KEYS } from "@/config";

export function useAudioContextSettings() {
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

  return {
    useSystemPrompt,
    setUseSystemPrompt: updateUseSystemPrompt,
    setRawUseSystemPrompt: setUseSystemPrompt,
    contextContent,
    setContextContent: updateContextContent,
    setRawContextContent: setContextContent,
    respondToMic,
    setRespondToMic: updateRespondToMic,
    respondToMicRef,
  };
}
