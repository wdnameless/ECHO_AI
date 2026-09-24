import { safeLocalStorage } from "./storage/helper";

/**
 * Language the recogniser is told to expect.
 *
 * This is deliberately NOT the answer language: `responseSettings.language`
 * defaults to "english" and both streaming channels used to pin the model to
 * `en` from it, so Russian speech came back transliterated as English words
 * ("Is Zbatsovki transporte zabatsovka"). Recognition follows the audio;
 * answering follows the response setting.
 */
export type AsrLanguage = "auto" | "ru" | "en";

export const ASR_LANGUAGE_STORAGE_KEY = "asr_language";

export const DEFAULT_ASR_LANGUAGE: AsrLanguage = "auto";

export const ASR_LANGUAGE_OPTIONS: ReadonlyArray<{
  id: AsrLanguage;
  label: string;
  hint: string;
}> = [
  {
    id: "auto",
    label: "Авто",
    hint: "Определять язык по речи. На смене языка движок перезапускает распознавание всего фрагмента — заметно медленнее.",
  },
  {
    id: "ru",
    label: "Русский",
    hint: "Всегда русский. Для интервью на русском — самый быстрый и точный режим.",
  },
  {
    id: "en",
    label: "English",
    hint: "Всегда английский. Для интервью на английском — самый быстрый и точный режим.",
  },
];

/** Value sent to the sidecar's `config` frame. */
export function getAsrLanguage(): AsrLanguage {
  const stored = safeLocalStorage.getItem(ASR_LANGUAGE_STORAGE_KEY);
  return stored === "ru" || stored === "en" || stored === "auto"
    ? stored
    : DEFAULT_ASR_LANGUAGE;
}

export function setAsrLanguage(language: AsrLanguage): void {
  safeLocalStorage.setItem(ASR_LANGUAGE_STORAGE_KEY, language);
}
