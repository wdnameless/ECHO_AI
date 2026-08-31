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

export function getJobProfiles(): JobProfile[] {
  const stored = safeLocalStorage.getItem(JOB_PROFILES_STORAGE_KEY);
  if (!stored) return [...DEFAULT_JOB_PROFILES];
  try {
    const parsed = JSON.parse(stored) as JobProfile[];
    if (!Array.isArray(parsed)) return [...DEFAULT_JOB_PROFILES];

    const builtins = DEFAULT_JOB_PROFILES.map((b) => {
      const existing = parsed.find((p) => p.id === b.id);
      return existing ? { ...b, ...existing, isBuiltin: true } : b;
    });
    const customs = parsed.filter((p) => !p.isBuiltin);
    return [...builtins, ...customs];
  } catch {
    return [...DEFAULT_JOB_PROFILES];
  }
}

export function saveJobProfiles(profiles: JobProfile[]): void {
  safeLocalStorage.setItem(JOB_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

export function getActiveJobProfileId(): string {
  const id = safeLocalStorage.getItem(ACTIVE_JOB_PROFILE_STORAGE_KEY);
  const profiles = getJobProfiles();
  if (id && profiles.some((p) => p.id === id)) return id;
  return DEFAULT_JOB_PROFILES[0].id;
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
