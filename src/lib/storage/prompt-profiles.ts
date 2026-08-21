import { safeLocalStorage } from "./helper";
import { DEFAULT_SYSTEM_PROMPT, STORAGE_KEYS } from "@/config/constants";
import { HUMANIZER_STORAGE_KEY } from "@/config/humanizer.rules";

export const PROFILE_STORAGE_KEY = "prompt_profiles";
export const ACTIVE_PROFILE_STORAGE_KEY = "active_profile_id";

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
}

export const INTERVIEW_PROFILE_ID = "profile-interview";
export const GENERAL_PROFILE_ID = "profile-general";
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
  },
  {
    id: GENERAL_PROFILE_ID,
    name: "General Chat",
    description: "Free conversation with the AI - no interview prompts",
    systemPrompt:
      "You are a friendly, natural conversation partner. Answer in a warm, human tone. Be concise but thoughtful, ask follow-up questions when appropriate.",
    humanizerEnabled: true,
    interviewMode: false,
    customStyle: "",
    ragResumeEnabled: false,
    ragJobEnabled: false,
    isBuiltin: true,
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
  },
];

export function getPromptProfiles(): PromptProfile[] {
  const stored = safeLocalStorage.getItem(PROFILE_STORAGE_KEY);
  if (!stored) return [...BUILTIN_PROFILES];
  try {
    const parsed = JSON.parse(stored) as PromptProfile[];
    if (!Array.isArray(parsed)) return [...BUILTIN_PROFILES];
    // Merge built-ins (so updated built-ins always exist) + custom ones
    const builtins = BUILTIN_PROFILES.map((b) => {
      const existing = parsed.find((p) => p.id === b.id);
      return existing ? { ...b, ...existing, isBuiltin: true } : b;
    });
    const customs = parsed.filter((p) => !p.isBuiltin);
    return [...builtins, ...customs];
  } catch {
    return [...BUILTIN_PROFILES];
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
}
