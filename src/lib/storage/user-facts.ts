import { safeLocalStorage } from "./helper";

export const USER_FACTS_STORAGE_KEY = "user_memory_facts";
export const USER_STYLE_STORAGE_KEY = "user_memory_style";
export const FEEDBACK_LOG_STORAGE_KEY = "user_feedback_log";
export const USER_MARKDOWN_STORAGE_KEY = "user_markdown_profile";

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
  favoritePatterns: string[];
  avoidPatterns: string[];
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
  preferredLength: "concise",
  favoritePatterns: [
    "Объяснять ход мыслей (почему именно так)",
    "Приводить реальные примеры из продакшена",
    "Использовать естественные разговорные заходы",
  ],
  avoidPatterns: [
    "Маркированные и нумерованные списки",
    "Робо-клише ('Стоит отметить', 'В заключение')",
    "Сухой книжный тон из учебников",
    "Длинные абзацы текста",
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
  saveUserFacts(facts.slice(0, 50));
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

  const style = getUserStylePreferences();

  if (rating === "like") {
    if (response.length < 150 && !style.favoritePatterns.includes("Краткие и ёмкие ответы (до 3 предложений)")) {
      style.favoritePatterns.push("Краткие и ёмкие ответы (до 3 предложений)");
    }
  } else if (rating === "dislike" && reason) {
    const reasonText = reason.trim();
    if (!style.avoidPatterns.includes(reasonText)) {
      style.avoidPatterns.push(reasonText);
    }
    if (reasonText.toLowerCase().includes("длинн") || reasonText.toLowerCase().includes("воды")) {
      style.preferredLength = "concise";
    }
  }

  saveUserStylePreferences(style);
  return entry;
}

/**
 * Generates clean USER.md markdown representation for the profile.
 */
export function getUserMarkdownProfile(): string {
  const customMd = safeLocalStorage.getItem(USER_MARKDOWN_STORAGE_KEY);
  if (customMd && customMd.trim()) {
    return customMd;
  }

  const facts = getUserFacts();
  const style = getUserStylePreferences();
  const logs = getFeedbackLog();
  const likesCount = logs.filter((l) => l.rating === "like").length;
  const dislikesCount = logs.filter((l) => l.rating === "dislike").length;

  return `# USER.md - Personal Context & Self-Evolution Memory
# Total Ratings: 👍 ${likesCount} | 👎 ${dislikesCount}

## 👤 Personal Facts & Background
${facts.map((f) => `- [${f.category}] ${f.fact}`).join("\n")}

## 🎨 Preferred Style & Tone
- **Tone**: ${style.tone}
- **Length**: ${style.preferredLength === "concise" ? "Краткий и ёмкий (1-3 предложения, без лишней воды)" : "Сбалансированный"}
- **Favorite Patterns**:
${style.favoritePatterns.map((p) => `  - ${p}`).join("\n")}

## 🚫 Avoid Constraints (Learned Rules)
${style.avoidPatterns.map((p) => `- ${p}`).join("\n")}

## 📝 Custom Rules
${style.customRules.length > 0 ? style.customRules.map((r) => `- ${r}`).join("\n") : "- Отвечать кратко, живо, прямо к сути (35-50 слов max)."}
`.trim();
}

/**
 * Saves raw USER.md text edited by the user directly.
 */
export function saveUserMarkdownProfile(markdown: string): void {
  safeLocalStorage.setItem(USER_MARKDOWN_STORAGE_KEY, markdown.trim());
}

/**
 * Resets custom USER.md to auto-compiled template.
 */
export function resetUserMarkdownProfile(): void {
  safeLocalStorage.removeItem(USER_MARKDOWN_STORAGE_KEY);
}

/**
 * Builds the compiled prompt injection for the Self-Evolution profile.
 */
export function buildSelfEvolutionPromptBlock(): string {
  const customMd = safeLocalStorage.getItem(USER_MARKDOWN_STORAGE_KEY);
  if (customMd && customMd.trim()) {
    return `[SELF-EVOLUTION PROFILE (USER.md)]\n${customMd.trim()}\n[/SELF-EVOLUTION PROFILE]`;
  }

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
[SELF-EVOLUTION ADAPTIVE PROFILE - ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ (USER.md)]
Ты работаешь в режиме самообучения (Self-Evolution). Ты обязан максимально адаптироваться под личность, опыт и предпочтения этого конкретного пользователя (на основе ${likesCount} одобрений и ${dislikesCount} замечаний).

1. БАЗА ЗНАНИЙ И ФАКТОВ О ПОЛЬЗОВАТЕЛЕ:
${factsLines || "- Опытный специалист, ценит точность и практичность"}

2. ВЫУЧЕННЫЙ СТИЛЬ И ПАТТЕРНЫ ОТВЕТОВ:
- Тональность: ${style.tone}
- Желаемый объем: Краткий и ёмкий (1-3 коротких предложения, 35-50 слов max, БЕЗ ЛИШНЕЙ ВОДЫ)
${favoritesLines}
${avoidLines}
${customLines ? `\n3. КАСТОМНЫЕ ПРАВИЛА:\n${customLines}` : ""}

Подстраивай каждый ответ под эту модель личности!
`.trim();
}
