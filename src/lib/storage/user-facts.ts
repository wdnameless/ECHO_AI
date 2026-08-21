import { safeLocalStorage } from "./helper";

export const USER_FACTS_STORAGE_KEY = "user_memory_facts";
export const USER_STYLE_STORAGE_KEY = "user_memory_style";
export const FEEDBACK_LOG_STORAGE_KEY = "user_feedback_log";

export interface UserFact {
  id: string;
  category: "background" | "stack" | "role" | "preference" | "general";
  fact: string;
  confidence: number; // 0..1
  source: "feedback" | "manual" | "extracted";
  timestamp: number;
}

export interface UserStylePreference {
  tone: string; // e.g. "живой, лаконичный, без занудства"
  preferredLength: "concise" | "balanced" | "detailed";
  favoritePatterns: string[]; // ["объяснять шаги", "начинать сразу с сути", "приводить реальные цифры"]
  avoidPatterns: string[]; // ["нумерованные списки", "робо-клише", "повторяющееся 'Ну смотри'"]
  customRules: string[];
}

export interface FeedbackEntry {
  id: string;
  question: string;
  response: string;
  rating: "like" | "dislike";
  reason?: string;
  topic?: string;
  extractedFact?: string;
  timestamp: number;
}

export const DEFAULT_STYLE_PREFERENCES: UserStylePreference = {
  tone: "живой, естественный, как разговор двух опытных инженеров",
  preferredLength: "balanced",
  favoritePatterns: [
    "Объяснять ход мыслей (почему именно так)",
    "Приводить реальные примеры из продакшена",
    "Использовать естественные разговорные заходы",
  ],
  avoidPatterns: [
    "Маркированные и нумерованные списки",
    "Робо-клише ('Стоит отметить', 'В заключение')",
    "Сухой книжный тон из учебников",
  ],
  customRules: [],
};

export const DEFAULT_FACTS: UserFact[] = [
  {
    id: "fact-init-1",
    category: "role",
    fact: "Senior Software Engineer / Team Lead с глубоким продакшен-опытом",
    confidence: 1.0,
    source: "manual",
    timestamp: Date.now(),
  },
  {
    id: "fact-init-2",
    category: "preference",
    fact: "Предпочитает объяснять решения через призму архитектурных трейд-оффов и метрик",
    confidence: 0.9,
    source: "manual",
    timestamp: Date.now(),
  },
];

export function getUserFacts(): UserFact[] {
  const raw = safeLocalStorage.getItem(USER_FACTS_STORAGE_KEY);
  if (!raw) return [...DEFAULT_FACTS];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [...DEFAULT_FACTS];
  } catch {
    return [...DEFAULT_FACTS];
  }
}

export function saveUserFacts(facts: UserFact[]): void {
  safeLocalStorage.setItem(USER_FACTS_STORAGE_KEY, JSON.stringify(facts));
}

export function addUserFact(factText: string, category: UserFact["category"] = "general"): UserFact {
  const facts = getUserFacts();
  const trimmed = factText.trim();
  const existing = facts.find((f) => f.fact.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    existing.confidence = Math.min(1.0, existing.confidence + 0.1);
    existing.timestamp = Date.now();
    saveUserFacts(facts);
    return existing;
  }

  const newFact: UserFact = {
    id: `fact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    category,
    fact: trimmed,
    confidence: 0.85,
    source: "extracted",
    timestamp: Date.now(),
  };
  facts.unshift(newFact);
  saveUserFacts(facts.slice(0, 50)); // Cap to 50 active high-value facts
  return newFact;
}

export function removeUserFact(id: string): void {
  const facts = getUserFacts().filter((f) => f.id !== id);
  saveUserFacts(facts);
}

export function getUserStylePreferences(): UserStylePreference {
  const raw = safeLocalStorage.getItem(USER_STYLE_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_STYLE_PREFERENCES };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STYLE_PREFERENCES, ...parsed };
  } catch {
    return { ...DEFAULT_STYLE_PREFERENCES };
  }
}

export function saveUserStylePreferences(style: UserStylePreference): void {
  safeLocalStorage.setItem(USER_STYLE_STORAGE_KEY, JSON.stringify(style));
}

export function getFeedbackLog(): FeedbackEntry[] {
  const raw = safeLocalStorage.getItem(FEEDBACK_LOG_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordFeedback(
  question: string,
  response: string,
  rating: "like" | "dislike",
  reason?: string,
  topic?: string
): FeedbackEntry {
  const logs = getFeedbackLog();
  const entry: FeedbackEntry = {
    id: `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    question: question.trim(),
    response: response.trim(),
    rating,
    reason: reason?.trim(),
    topic: topic || "general",
    timestamp: Date.now(),
  };

  logs.unshift(entry);
  safeLocalStorage.setItem(FEEDBACK_LOG_STORAGE_KEY, JSON.stringify(logs.slice(0, 100)));

  // Automatic evolution: Update style preferences and learn facts on feedback!
  const style = getUserStylePreferences();

  if (rating === "like") {
    // If user likes long answers with reasoning, reinforce thinking pattern
    if (response.length > 200 && !style.favoritePatterns.includes("Развернутое объяснение с деталями")) {
      style.favoritePatterns.push("Развернутое объяснение с деталями");
    }
  } else if (rating === "dislike" && reason) {
    // Add negative constraint based on user reason
    const reasonText = reason.trim();
    if (!style.avoidPatterns.includes(reasonText)) {
      style.avoidPatterns.push(reasonText);
    }
    // Handle specific reasons
    if (reasonText.toLowerCase().includes("длинн") || reasonText.toLowerCase().includes("воды")) {
      style.preferredLength = "concise";
    }
  }

  saveUserStylePreferences(style);
  return entry;
}

/**
 * Builds the rich compiled prompt injection for the Self-Evolution profile.
 */
export function buildSelfEvolutionPromptBlock(): string {
  const facts = getUserFacts();
  const style = getUserStylePreferences();
  const logs = getFeedbackLog();

  const likesCount = logs.filter((l) => l.rating === "like").length;
  const dislikesCount = logs.filter((l) => l.rating === "dislike").length;

  const factsLines = facts.map((f) => `- ${f.fact}`).join("\n");
  const favoritesLines = style.favoritePatterns.map((p) => `- Поощряется: ${p}`).join("\n");
  const avoidLines = style.avoidPatterns.map((p) => `- Категорически избегать: ${p}`).join("\n");
  const customLines = style.customRules.map((r) => `- Личное правило: ${r}`).join("\n");

  return `
[SELF-EVOLUTION ADAPTIVE PROFILE - ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ]
Ты работаешь в режиме самообучения (Self-Evolution). Ты обязан максимально адаптироваться под личность, опыт и предпочтения этого конкретного пользователя (на основе ${likesCount} одобрений и ${dislikesCount} замечаний).

1. БАЗА ЗНАНИЙ И ФАКТОВ О ПОЛЬЗОВАТЕЛЕ:
${factsLines || "- Опытный специалист, ценит точность и практичность"}

2. ВЫУЧЕННЫЙ СТИЛЬ И ПАТТЕРНЫ ОТВЕТОВ:
- Тональность: ${style.tone}
- Желаемый объем: ${style.preferredLength === "concise" ? "Краткий и ёмкий (без лишней воды)" : "Сбалансированный с понятными примерами"}
${favoritesLines}
${avoidLines}
${customLines ? `\n3. КАСТОМНЫЕ ПРАВИЛА:\n${customLines}` : ""}

Подстраивай каждый ответ под эту модель личности!
`.trim();
}
