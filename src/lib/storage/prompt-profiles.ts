import { safeLocalStorage } from "./helper";
import { DEFAULT_SYSTEM_PROMPT, STORAGE_KEYS } from "@/config/constants";
import { HUMANIZER_STORAGE_KEY } from "@/config/humanizer.rules";
import { updateResponseLength } from "./response-settings.storage";
export const PROFILE_STORAGE_KEY = "prompt_profiles";
export const ACTIVE_PROFILE_STORAGE_KEY = "active_profile_id";
/** Built-in profiles the user has deleted; they must not come back on reload. */
export const REMOVED_BUILTIN_PROFILES_KEY = "prompt_profiles_removed_builtins";

export type ProfileResponseLength = "auto" | "short" | "long";

export type ToolbarButtonId =
  | "length"
  | "thought"
  | "livecode"
  | "answer"
  | "code_plan"
  | "code_full"
  | "code_screen"
  | "screenshot"
  | "audio_settings"
  | "settings"
  | "new_chat"
  | "monologue_send";

export interface MonologueConfig {
  mode: "auto" | "semi" | "manual";
  maxWindow: number;
}

export interface PromptProfile {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  humanizerEnabled: boolean;
  interviewMode: boolean;
  customStyle: string;
  ragResumeEnabled: boolean;
  ragJobEnabled: boolean;
  isBuiltin?: boolean;
  flushGapMs?: number;
  defaultLength?: ProfileResponseLength;
  visibleButtons?: string[];
  monologue?: MonologueConfig;
}

export const INTERVIEW_PROFILE_ID = "profile-interview";
export const GENERAL_PROFILE_ID = "profile-general";
export const CONVERSATION_PROFILE_ID = "profile-general";
export const LIVECODE_PROFILE_ID = "profile-livecode";
export const SELF_EVOLUTION_PROFILE_ID = "profile-self-evolution";
export const BUILTIN_PROFILES: PromptProfile[] = [
  {
    id: INTERVIEW_PROFILE_ID,
    name: "Interview",
    description: "Stealth interview assistant: organic answers for HR & tech interviews",
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    humanizerEnabled: true,
    interviewMode: true,
    customStyle: "",
    ragResumeEnabled: true,
    ragJobEnabled: true,
    isBuiltin: true,
    flushGapMs: 450,
    defaultLength: "short",
    visibleButtons: [
      "length",
      "thought",
      "answer",
      "screenshot",
      "audio_settings",
      "settings",
      "new_chat",
    ],
    monologue: {
      mode: "auto",
      maxWindow: 4000,
    },
  },
  {
    id: GENERAL_PROFILE_ID,
    name: "General Chat",
    description: "Free conversation with the AI - monologue accumulation & natural pacing",
    systemPrompt:
      "You are a friendly, natural conversation partner. Answer in a warm, human tone. Be concise but thoughtful, ask follow-up questions when appropriate.",
    humanizerEnabled: true,
    interviewMode: false,
    customStyle: "",
    ragResumeEnabled: false,
    ragJobEnabled: false,
    isBuiltin: true,
    flushGapMs: 1500,
    defaultLength: "auto",
    visibleButtons: [
      "length",
      "thought",
      "answer",
      "monologue_send",
      "screenshot",
      "audio_settings",
      "settings",
      "new_chat",
    ],
    monologue: {
      mode: "auto",
      maxWindow: 15000,
    },
  },
  {
    id: LIVECODE_PROFILE_ID,
    name: "Livecode",
    description: "Live coding assistant: plan first, structured algorithms, complexity analysis",
    systemPrompt: `Ты — эксперт по алгоритмам, структурам данных и лайвкодингу (LeetCode / Codeforces / FAANG).
ПРИНЦИПЫ ОТВЕТА:
1. При обсуждении задачи сначала озвучь краткий план решения (1-2 предложения: идея, оптимальная сложность).
2. При написании кода выдавай эталонный production-ready код с учётом граничных условий.
3. Обязательно указывай временную и пространственную сложность (Big-O).
4. Объясняй логику лаконично, как опытный senior разработчик на интервью.`,
    humanizerEnabled: true,
    interviewMode: true,
    customStyle: "",
    ragResumeEnabled: false,
    ragJobEnabled: false,
    isBuiltin: true,
    flushGapMs: 500,
    defaultLength: "auto",
    visibleButtons: [
      "length",
      "thought",
      "livecode",
      "code_plan",
      "code_full",
      "code_screen",
      "answer",
      "screenshot",
      "audio_settings",
      "settings",
      "new_chat",
    ],
    monologue: {
      mode: "auto",
      maxWindow: 6000,
    },
  },
  {
    id: SELF_EVOLUTION_PROFILE_ID,
    name: "Self-Evolution ✨",
    description: "Adaptive AI that learns from your 👍/👎 ratings, adapts tone to any topic, and recalls personal facts",
    systemPrompt: `Ты — персональный адаптивный ассистент, который учится и эволюционирует на основе обратной связи (лайки/дизлайки) и фактов о пользователе.

ГЛАВНЫЙ ПРИНЦИП:
- Подстраивай тональность, глубину и структуру под тему разговора (техника / бизнес / брейншторм / неформальное общение).
- Размышляй вслух, показывай ход мыслей, избегай сухих робо-ответов и ненужных списков.
- Строго учитывай накопленную базу фактов и предпочтений стиля пользователя.`,
    humanizerEnabled: true,
    interviewMode: false,
    customStyle: "",
    ragResumeEnabled: true,
    ragJobEnabled: true,
    isBuiltin: true,
    flushGapMs: 1500,
    defaultLength: "auto",
    visibleButtons: [
      "length",
      "thought",
      "answer",
      "screenshot",
      "audio_settings",
      "settings",
      "new_chat",
    ],
    monologue: {
      mode: "auto",
      maxWindow: 12000,
    },
  },
];

/**
 * Built-in profiles the user deleted.
 *
 * Built-ins are merged into whatever is stored on every load, so without this
 * list a deleted built-in would silently reappear on the next start.
 */
export function getRemovedBuiltinProfileIds(): string[] {
  const raw = safeLocalStorage.getItem(REMOVED_BUILTIN_PROFILES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function setRemovedBuiltinProfileIds(ids: string[]): void {
  safeLocalStorage.setItem(REMOVED_BUILTIN_PROFILES_KEY, JSON.stringify(ids));
}

/** Deletes a built-in by recording it as removed. */
export function removeBuiltinProfile(id: string): void {
  const removed = getRemovedBuiltinProfileIds();
  if (!removed.includes(id)) setRemovedBuiltinProfileIds([...removed, id]);
}

/** Undoes {@link removeBuiltinProfile}. */
export function restoreBuiltinProfile(id: string): void {
  setRemovedBuiltinProfileIds(getRemovedBuiltinProfileIds().filter((x) => x !== id));
}

/** Brings every deleted built-in back. Returns how many were restored. */
export function restoreAllBuiltinProfiles(): number {
  const removed = getRemovedBuiltinProfileIds();
  setRemovedBuiltinProfileIds([]);
  return removed.length;
}

export function getPromptProfiles(): PromptProfile[] {
  const removed = getRemovedBuiltinProfileIds();
  const availableBuiltins = BUILTIN_PROFILES.filter((b) => !removed.includes(b.id));
  const stored = safeLocalStorage.getItem(PROFILE_STORAGE_KEY);
  if (!stored) return [...availableBuiltins];
  try {
    const parsed = JSON.parse(stored) as PromptProfile[];
    if (!Array.isArray(parsed)) return [...availableBuiltins];
    // Merge built-ins (so updated built-ins always exist) + custom ones
    const builtins = availableBuiltins.map((b) => {
      const existing = parsed.find((p) => p.id === b.id);
      return existing ? { ...b, ...existing, isBuiltin: true } : b;
    });
    const customs = parsed.filter(
      (p) => !p.isBuiltin && !BUILTIN_PROFILES.some((b) => b.id === p.id)
    );
    return [...builtins, ...customs];
  } catch {
    return [...availableBuiltins];
  }
}

export function savePromptProfiles(profiles: PromptProfile[]): void {
  safeLocalStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
}

export function getActiveProfileId(): string {
  const id = safeLocalStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
  const profiles = getPromptProfiles();
  if (id && profiles.some((p) => p.id === id)) return id;
  return INTERVIEW_PROFILE_ID;
}

export function setActiveProfileId(id: string): void {
  safeLocalStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, id);
}

export function getActiveProfile(): PromptProfile {
  const id = getActiveProfileId();
  const profiles = getPromptProfiles();
  return profiles.find((p) => p.id === id) || profiles[0];
}

/**
 * Applies a profile's settings to the shared localStorage keys that the
 * rest of the app already reads (system prompt, humanizer, RAG toggles).
 */
export function applyProfileToStorage(profile: PromptProfile): void {
  safeLocalStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, profile.systemPrompt);
  safeLocalStorage.setItem(
    HUMANIZER_STORAGE_KEY,
    JSON.stringify({
      enabled: profile.humanizerEnabled,
      interviewMode: profile.interviewMode,
      customStyle: profile.customStyle,
    })
  );
  safeLocalStorage.setItem(
    STORAGE_KEYS.RAG_RESUME_ENABLED,
    String(profile.ragResumeEnabled)
  );
  safeLocalStorage.setItem(
    STORAGE_KEYS.RAG_JOB_ENABLED,
    String(profile.ragJobEnabled)
  );
  if (profile.defaultLength) {
    updateResponseLength(profile.defaultLength);
  }
  safeLocalStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, profile.id);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("prompt-profile-changed", { detail: profile })
    );
  }
}

export function exportProfileToJson(profile: PromptProfile): string {
  return JSON.stringify(profile, null, 2);
}

export function exportProfilesToJson(profiles: PromptProfile[]): string {
  return JSON.stringify(profiles, null, 2);
}

export function importProfileFromJson(json: string): PromptProfile | null {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.name !== "string" || !parsed.name.trim()) return null;
    if (typeof parsed.systemPrompt !== "string") return null;

    const profile: PromptProfile = {
      id:
        parsed.id && typeof parsed.id === "string"
          ? parsed.id
          : `profile-imported-${Date.now().toString(36)}`,
      name: parsed.name.trim(),
      description:
        typeof parsed.description === "string" ? parsed.description : "",
      systemPrompt: parsed.systemPrompt,
      humanizerEnabled: Boolean(parsed.humanizerEnabled),
      interviewMode: Boolean(parsed.interviewMode),
      customStyle:
        typeof parsed.customStyle === "string" ? parsed.customStyle : "",
      ragResumeEnabled: Boolean(parsed.ragResumeEnabled),
      ragJobEnabled: Boolean(parsed.ragJobEnabled),
      isBuiltin: false,
      flushGapMs:
        typeof parsed.flushGapMs === "number" ? parsed.flushGapMs : undefined,
      defaultLength: parsed.defaultLength,
      visibleButtons: Array.isArray(parsed.visibleButtons)
        ? parsed.visibleButtons
        : undefined,
      monologue:
        parsed.monologue && typeof parsed.monologue === "object"
          ? {
              mode:
                parsed.monologue.mode === "semi" ||
                parsed.monologue.mode === "manual"
                  ? parsed.monologue.mode
                  : "auto",
              maxWindow:
                typeof parsed.monologue.maxWindow === "number"
                  ? parsed.monologue.maxWindow
                  : 12000,
            }
          : undefined,
    };
    return profile;
  } catch {
    return null;
  }
}

export function importProfilesFromJson(json: string): PromptProfile[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => importProfileFromJson(JSON.stringify(item)))
        .filter((p): p is PromptProfile => p !== null);
    }
    const single = importProfileFromJson(json);
    return single ? [single] : [];
  } catch {
    return [];
  }
}
