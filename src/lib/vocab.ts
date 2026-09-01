import { invoke } from "@tauri-apps/api/core";

export interface AsrCorrection {
  id?: number;
  wrong: string;
  right: string;
  created_at?: number;
}

let cachedCorrections: AsrCorrection[] | null = null;
let loadPromise: Promise<AsrCorrection[]> | null = null;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function loadCorrections(forceReload = false): Promise<AsrCorrection[]> {
  if (cachedCorrections !== null && !forceReload) {
    return cachedCorrections;
  }
  if (loadPromise && !forceReload) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      const items = await invoke<AsrCorrection[]>("get_corrections");
      cachedCorrections = items || [];
      return cachedCorrections;
    } catch (e) {
      console.error("[Vocab] Failed to load corrections:", e);
      if (!cachedCorrections) {
        cachedCorrections = [];
      }
      return cachedCorrections;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

export function getCachedCorrections(): AsrCorrection[] {
  return cachedCorrections ?? [];
}
export function setCachedCorrections(corrections: AsrCorrection[]): void {
  cachedCorrections = [...corrections];
}


export async function addCorrection(wrong: string, right: string): Promise<AsrCorrection> {
  const cleanWrong = wrong.trim();
  const cleanRight = right.trim();
  if (!cleanWrong || !cleanRight) {
    throw new Error("Wrong and right text must not be empty");
  }

  const result = await invoke<AsrCorrection>("add_correction", {
    wrong: cleanWrong,
    right: cleanRight,
  });

  if (!cachedCorrections) {
    cachedCorrections = [];
  }
  const idx = cachedCorrections.findIndex(
    (c) => c.wrong.toLowerCase() === cleanWrong.toLowerCase()
  );
  if (idx >= 0) {
    cachedCorrections[idx] = result;
  } else {
    cachedCorrections.unshift(result);
  }

  return result;
}

export async function deleteCorrection(id: number): Promise<void> {
  await invoke("delete_correction", { id });
  if (cachedCorrections) {
    cachedCorrections = cachedCorrections.filter((c) => c.id !== id);
  }
}

export function applyCorrections(text: string, corrections?: AsrCorrection[]): string {
  if (!text) return text;
  const list = corrections ?? cachedCorrections ?? [];
  if (list.length === 0) return text;

  let result = text;
  const sorted = [...list].sort((a, b) => b.wrong.length - a.wrong.length);

  for (const item of sorted) {
    const wrong = item.wrong.trim();
    if (!wrong) continue;

    const escaped = escapeRegex(wrong);
    const pattern = `(?<=^|[^\\p{L}\\p{N}_])${escaped}(?=[^\\p{L}\\p{N}_]|$)`;

    try {
      const regex = new RegExp(pattern, "gui");
      result = result.replace(regex, item.right);
    } catch {
      const fallbackRegex = new RegExp(`\\b${escaped}\\b`, "gi");
      result = result.replace(fallbackRegex, item.right);
    }
  }

  return result;
}

export function buildInitialPrompt(corrections?: AsrCorrection[], maxCount = 30): string {
  const list = corrections ?? cachedCorrections ?? [];
  if (list.length === 0) return "";

  const hints: string[] = [];
  const count = Math.min(list.length, maxCount);

  for (let i = 0; i < count; i++) {
    const c = list[i];
    if (c && c.wrong && c.right) {
      hints.push(`${c.wrong}→${c.right}`);
    }
  }

  let prompt = hints.join(", ");
  if (prompt.length > 500) {
    prompt = prompt.slice(0, 500);
    const lastComma = prompt.lastIndexOf(",");
    if (lastComma > 0) {
      prompt = prompt.slice(0, lastComma);
    }
  }

  return prompt;
}
