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
    hint: "Движок определяет язык сам. При промахе детектора он заново распознаёт всю реплику — измерено до 13 секунд лишней задержки, а на batch-пути тот же промах ронял движок. Если распознавание тормозит или выдаёт не тот язык — выберите язык вручную.",
  },
  {
    id: "ru",
    label: "Русский",
    hint: "Всегда русский: без промахов детектора — самый быстрый и точный режим для интервью на русском. Смена языка применяется со следующей реплики.",
  },
  {
    id: "en",
    label: "English",
    hint: "Всегда английский: без промахов детектора — самый быстрый и точный режим для интервью на английском. Смена языка применяется со следующей реплики.",
  },
];

/**
 * Value sent to the sidecar's `config` frame.
 *
 * The language is DECLARED, not inferred. An earlier version learned it from the
 * engine's own transcripts, which closed a loop: with the wrong language the
 * engine produces fluent-looking gibberish in the other script (English speech
 * came back as Cyrillic), so the learner locked in the very mistake it was meant
 * to correct. The engine cannot be its own teacher — its detector misfired 41
 * times in one log, each misfire re-running the whole utterance, and on the batch
 * endpoint crashing the process.
 *
 * `auto` therefore stays exactly what the user chose, with the cost documented in
 * the option hint; pinning is one click and removes the re-run path entirely.
 */
export function getAsrLanguage(): AsrLanguage {
  const stored = safeLocalStorage.getItem(ASR_LANGUAGE_STORAGE_KEY);
  return stored === "ru" || stored === "en" || stored === "auto"
    ? stored
    : DEFAULT_ASR_LANGUAGE;
}

export function setAsrLanguage(language: AsrLanguage): void {
  safeLocalStorage.setItem(ASR_LANGUAGE_STORAGE_KEY, language);
}
