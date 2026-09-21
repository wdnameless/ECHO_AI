import { safeLocalStorage } from "./helper";
import { STORAGE_KEYS } from "@/config/constants";

export interface JobProfile {
  id: string;
  name: string;
  description?: string;
  contextContent: string;
  isBuiltin?: boolean;
}

export const JOB_PROFILES_STORAGE_KEY = STORAGE_KEYS.JOB_PROFILES;
export const ACTIVE_JOB_PROFILE_STORAGE_KEY = STORAGE_KEYS.ACTIVE_JOB_PROFILE_ID;
/** Built-in job profiles the user deleted; they must not come back on reload. */
export const REMOVED_BUILTIN_JOB_PROFILES_KEY = "job_profiles_removed_builtins";

export const DEFAULT_JOB_PROFILES: JobProfile[] = [
  {
    id: "frontend-senior",
    name: "Senior Frontend / React",
    description: "Резюме и контекст: Senior Frontend Developer (React, TypeScript, Next.js, Web Performance)",
    contextContent: `Кандидат: Senior Frontend Engineer.
Стек: TypeScript, React, Next.js, Redux Toolkit, Webpack/Vite, TailwindCSS, WebSockets, Testing Library.
Опыт: 6+ лет разработки сложных веб-интерфейсов, микрофронтендов, оптимизации Core Web Vitals.
Фокус: компонентная архитектура, производительность рендеринга, доступность (a11y), отзывчивость и чистота кода.`,
    isBuiltin: true,
  },
  {
    id: "backend-engineer",
    name: "Backend / Distributed Systems",
    description: "Резюме и контекст: Backend Engineer (Go/Node/Rust, PostgreSQL, Kafka, Microservices)",
    contextContent: `Кандидат: Backend Engineer.
Стек: Go, Node.js, Rust, PostgreSQL, Redis, Kafka, gRPC, Docker, Kubernetes.
Опыт: 5+ лет проектирования микросервисов, работы с транзакциями, репликацией и очередями сообщений.
Фокус: масштабируемость, отказоустойчивость, чистый API, низкие задержки (p99 latency).`,
    isBuiltin: true,
  },
  {
    id: "system-design-techlead",
    name: "TechLead / System Design",
    description: "Резюме и контекст: TechLead (System Design, Highload, Architecture & People Management)",
    contextContent: `Кандидат: TechLead / Solutions Architect.
Стек: Cloud Native Architecture, Highload, Distributed Caching, Event-Driven Architecture, Observability.
Опыт: 8+ лет в индустрии, руководство командами разработки, проектирование систем с миллионами пользователей.
Фокус: System Design, декомпозиция задач, trade-off анализ, масштабирование команд и систем.`,
    isBuiltin: true,
  },
  {
    id: "blank-profile",
    name: "Чистый контекст",
    description: "Пустой шаблон для быстрого ввода резюме и описания вакансии",
    contextContent: "",
    isBuiltin: true,
  },
];

/**
 * Built-in job profiles the user deleted.
 *
 * Built-ins are merged into whatever is stored on every load, so without this
 * list a deleted built-in would silently reappear on the next start.
 */
export function getRemovedBuiltinJobProfileIds(): string[] {
  const raw = safeLocalStorage.getItem(REMOVED_BUILTIN_JOB_PROFILES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function setRemovedBuiltinJobProfileIds(ids: string[]): void {
  safeLocalStorage.setItem(REMOVED_BUILTIN_JOB_PROFILES_KEY, JSON.stringify(ids));
}

/** Deletes a built-in by recording it as removed. */
export function removeBuiltinJobProfile(id: string): void {
  const removed = getRemovedBuiltinJobProfileIds();
  if (!removed.includes(id)) setRemovedBuiltinJobProfileIds([...removed, id]);
}

/** Undoes {@link removeBuiltinJobProfile}. */
export function restoreBuiltinJobProfile(id: string): void {
  setRemovedBuiltinJobProfileIds(getRemovedBuiltinJobProfileIds().filter((x) => x !== id));
}

/** Brings every deleted built-in back. Returns how many were restored. */
export function restoreAllBuiltinJobProfiles(): number {
  const removed = getRemovedBuiltinJobProfileIds();
  setRemovedBuiltinJobProfileIds([]);
  return removed.length;
}

export function getJobProfiles(): JobProfile[] {
  const removed = getRemovedBuiltinJobProfileIds();
  const availableBuiltins = DEFAULT_JOB_PROFILES.filter((b) => !removed.includes(b.id));
  const stored = safeLocalStorage.getItem(JOB_PROFILES_STORAGE_KEY);
  if (!stored) return [...availableBuiltins];
  try {
    const parsed = JSON.parse(stored) as JobProfile[];
    if (!Array.isArray(parsed)) return [...availableBuiltins];

    const builtins = availableBuiltins.map((b) => {
      const existing = parsed.find((p) => p.id === b.id);
      return existing ? { ...b, ...existing, isBuiltin: true } : b;
    });
    const customs = parsed.filter(
      (p) => !p.isBuiltin && !DEFAULT_JOB_PROFILES.some((b) => b.id === p.id)
    );
    return [...builtins, ...customs];
  } catch {
    return [...availableBuiltins];
  }
}

export function saveJobProfiles(profiles: JobProfile[]): void {
  safeLocalStorage.setItem(JOB_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

export function getActiveJobProfileId(): string {
  const id = safeLocalStorage.getItem(ACTIVE_JOB_PROFILE_STORAGE_KEY);
  const profiles = getJobProfiles();
  if (id && profiles.some((p) => p.id === id)) return id;
  return profiles[0]?.id ?? DEFAULT_JOB_PROFILES[0].id;
}

export function setActiveJobProfileId(id: string): void {
  safeLocalStorage.setItem(ACTIVE_JOB_PROFILE_STORAGE_KEY, id);
}

export function getActiveJobProfile(): JobProfile | null {
  const id = getActiveJobProfileId();
  const profiles = getJobProfiles();
  return profiles.find((p) => p.id === id) || null;
}

/**
 * Applies job profile to storage:
 * - Updates active profile id
 * - Writes contextContent to SYSTEM_AUDIO_CONTEXT with useSystemPrompt=true (custom context active in audio session)
 */
export function applyJobProfileToStorage(profile: JobProfile): void {
  setActiveJobProfileId(profile.id);
  const contextSettings = {
    useSystemPrompt: true,
    contextContent: profile.contextContent,
  };
  safeLocalStorage.setItem(
    STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT,
    JSON.stringify(contextSettings)
  );
}
