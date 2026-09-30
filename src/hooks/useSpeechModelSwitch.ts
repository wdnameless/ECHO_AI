import { useState } from "react";
import { listModels, selectedModel, selectModel } from "@/lib/storage/app-paths";
import { setAsrLanguage, type AsrLanguage } from "@/lib/asr-language";
import { safeLocalStorage } from "@/lib/storage/helper";

/**
 * Speech-model switch: RU/EN streaming model, not the recognition language.
 *
 * Why a separate state: `asr_language` (auto/ru/en) only pins the recogniser's
 * expected language on the SAME model — it cannot fix a monolingual English
 * model hearing Russian. The segment switches the MODEL the engine loads
 * (selectModel + restart), then pins the language to match.
 *
 * Model map (catalogue ids → engine file):
 * - ru → Voxtral-Mini-4B-Realtime-2602: the only streaming model with `ru`
 *   (WER 2.07, 2.6–4.4 GB — needs RAM/VRAM, said honestly in the UI).
 * - en → parakeet-unified-en-0.6b: WER 1.6, ~700 MB, recommended.
 *
 * No silent substitution: when the file is not on disk the caller gets
 * `{ ok: false, missingModel }` and shows "Скачать в Моделях" instead.
 * No auto-download: gigabytes over metered connections without asking is not
 * something this button does.
 */

export type SpeechModelLang = "ru" | "en";

const MODEL_BY_LANG: Record<SpeechModelLang, { id: string; asr: AsrLanguage }> = {
  ru: { id: "Voxtral-Mini-4B-Realtime-2602", asr: "ru" },
  en: { id: "parakeet-unified-en-0.6b", asr: "en" },
};

const STORAGE_KEY = "speech_model_lang";

export function getSpeechModelLang(): SpeechModelLang {
  const stored = safeLocalStorage.getItem(STORAGE_KEY);
  return stored === "en" ? "en" : "ru";
}

export function useSpeechModelSwitch() {
  const [lang, setLang] = useState<SpeechModelLang>(() => getSpeechModelLang());
  const [switching, setSwitching] = useState(false);

  const switchTo = async (next: SpeechModelLang): Promise<{ ok: boolean; missingModel?: string }> => {
    if (next === lang || switching) return { ok: next === lang };
    setSwitching(true);
    try {
      const [installed, active] = await Promise.all([listModels(), selectedModel()]);
      const want = MODEL_BY_LANG[next];
      const file = installed.find((f) => f.model_id === want.id);
      if (!file) return { ok: false, missingModel: want.id };
      if (active?.file_name !== file.file_name) {
        await selectModel(file.path);
        // selectModel restarts the engine and drops both ASR caches itself.
      }
      // Already on it (e.g. switched in Models page): just sync the state.
      setAsrLanguage(want.asr);
      setLang(next);
      safeLocalStorage.setItem(STORAGE_KEY, next);
      return { ok: true };
    } catch {
      return { ok: false };
    } finally {
      setSwitching(false);
    }
  };

  return { lang, switching, switchTo };
}
