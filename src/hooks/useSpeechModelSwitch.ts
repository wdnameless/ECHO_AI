import { useState } from "react";
import { listModels, selectedModel, selectModel } from "@/lib/storage/app-paths";
import { setAsrLanguage, type AsrLanguage } from "@/lib/asr-language";
import { safeLocalStorage } from "@/lib/storage/helper";

/**
 * Speech-model switch: RU/EN model pair, not the recognition language.
 *
 * Why a separate state: `asr_language` (auto/ru/en) only pins the recogniser's
 * expected language on the SAME model — it cannot fix a monolingual English
 * model hearing Russian. The segment switches the MODEL the engine loads
 * (selectModel + restart), then pins the language to match.
 *
 * Model map (catalogue ids → engine file):
 * - ru → parakeet-tdt-0.6b-v3: WER 1.94, speed 96, ~700 MB. Batch-only
 *   (streaming:false), so RU goes through the 300ms batch cadence — no socket
 *   partials, but ~64ms per pass. A RU-streaming model lighter than 4.5 GB
 *   does not exist in the catalogue (Voxtral is the only one and needs VRAM).
 * - en → parakeet-unified-en-0.6b: WER 1.6, speed 96, streaming, recommended.
 *
 * No silent substitution: when the file is not on disk the caller gets
 * `{ ok: false, missingModel }` and shows "Скачать в Моделях" instead.
 * No auto-download: gigabytes over metered connections without asking is not
 * something this button does.
 */

export type SpeechModelLang = "ru" | "en";

const MODEL_BY_LANG: Record<SpeechModelLang, { id: string; asr: AsrLanguage; quant: string | null }> = {
  // RU stays Q8: at WER 1.94 every 0.1 counts, and Q8 is the catalogue default.
  ru: { id: "parakeet-tdt-0.6b-v3", asr: "ru", quant: null },
  // EN has headroom (WER 1.6): Q4 halves RAM/disk, quality loss is inaudible.
  en: { id: "parakeet-unified-en-0.6b", asr: "en", quant: "Q4_K_M" },
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
      // EN prefers the Q4 file when present (same model, half the weight);
      // RU pins Q8. Fall back to whatever is installed rather than failing.
      const files = installed.filter((f) => f.model_id === want.id);
      const file =
        (want.quant && files.find((f) => f.quant === want.quant)) ??
        files.find((f) => f.quant === "Q8_0") ??
        files[0];
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
