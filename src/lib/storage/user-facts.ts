import { safeLocalStorage } from "./helper";
import {
  mirrorFeedback,
  mirrorStyle,
  resetSelfEvolutionDb,
} from "@/lib/self-evolution-persist";
import {
  extractSpeechStyle,
  getUserSpeechTranscripts,
  recordUserSpeech,
  USER_SPEECH_LOG_STORAGE_KEY,
  type SpeechStyle,
} from "@/lib/speech-style";

export {
  extractSpeechStyle,
  getUserSpeechTranscripts,
  recordUserSpeech,
  USER_SPEECH_LOG_STORAGE_KEY,
  type SpeechStyle,
};

export const USER_FACTS_STORAGE_KEY = "user_memory_facts";
export const USER_STYLE_STORAGE_KEY = "user_memory_style";
export const FEEDBACK_LOG_STORAGE_KEY = "user_feedback_log";
export const USER_MARKDOWN_STORAGE_KEY = "user_markdown_profile";
export const SELF_LEARNING_STORAGE_KEY = "self_learning_enabled";
export const USER_RULE_SOURCES_STORAGE_KEY = "user_memory_rule_sources";

export type RuleSource = "coach" | "manual" | "feedback";
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

export interface LearningProfile {
  facts: UserFact[];
  style: UserStylePreference;
  rules: string[];
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
  favoritePatterns: [],
  avoidPatterns: [],
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
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isSelfLearningEnabled(): boolean {
  const raw = safeLocalStorage.getItem(SELF_LEARNING_STORAGE_KEY);
  if (raw === null) return true;
  return raw === "true";
}

export function setSelfLearningEnabled(on: boolean): void {
  safeLocalStorage.setItem(SELF_LEARNING_STORAGE_KEY, on ? "true" : "false");
}

export function getLearningProfile(): LearningProfile {
  const facts = getUserFacts();
  const style = getUserStylePreferences();
  return {
    facts,
    style,
    rules: style.customRules,
  };
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
  const createDefault = (): UserStylePreference => ({
    tone: DEFAULT_STYLE_PREFERENCES.tone,
    preferredLength: DEFAULT_STYLE_PREFERENCES.preferredLength,
    favoritePatterns: [],
    avoidPatterns: [],
    customRules: [],
  });

  const raw = safeLocalStorage.getItem(USER_STYLE_STORAGE_KEY);
  if (!raw) return createDefault();
  try {
    const parsed = JSON.parse(raw);
    const defaults = createDefault();
    return {
      tone: typeof parsed?.tone === "string" ? parsed.tone : defaults.tone,
      preferredLength:
        parsed?.preferredLength === "balanced" || parsed?.preferredLength === "detailed"
          ? parsed.preferredLength
          : "concise",
      favoritePatterns: Array.isArray(parsed?.favoritePatterns)
        ? [...parsed.favoritePatterns]
        : defaults.favoritePatterns,
      avoidPatterns: Array.isArray(parsed?.avoidPatterns)
        ? [...parsed.avoidPatterns]
        : defaults.avoidPatterns,
      customRules: Array.isArray(parsed?.customRules)
        ? [...parsed.customRules]
        : defaults.customRules,
    };
  } catch {
    return createDefault();
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

export function saveFeedbackLog(log: FeedbackEntry[]): void {
  safeLocalStorage.setItem(FEEDBACK_LOG_STORAGE_KEY, JSON.stringify(log.slice(0, 200)));
}

export function recordFeedback(
  question: string,
  response: string,
  rating: "like" | "dislike",
  reason?: string,
  topic?: string
): FeedbackEntry {
  if (!isSelfLearningEnabled()) {
    return {
      id: "noop",
      question: question.trim(),
      response: response.trim(),
      rating,
      reason: reason?.trim(),
      topic: topic || "general",
      timestamp: Date.now(),
    };
  }
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
    // Store a short exemplar of the liked answer so the next answers mimic
    // its style. INFINITE learning: keep every exemplar, most recent first.
    const snippet = response.replace(/\s+/g, " ").trim().slice(0, 160);
    if (snippet && !style.favoritePatterns.includes(snippet)) {
      style.favoritePatterns.unshift(`Живой пример хорошего ответа: «${snippet}»`);
    }
  } else if (rating === "dislike" && reason) {
    const reasonText = reason.trim();
    if (!style.avoidPatterns.includes(reasonText)) {
      style.avoidPatterns.unshift(reasonText);
    }

    // Dynamic approach change driven by the specific complaint: each type of
    // dislike mutates a DIFFERENT part of the style profile immediately.
    if (/длин/i.test(reasonText)) {
      style.preferredLength = "concise";
    }
    if (/сухо|робот|безличн/i.test(reasonText)) {
      style.tone =
        "живой и тёплый, как разговор с коллегой; используй лёгкие человеческие обороты и эмоции там, где уместно";
    }
    if (/сложн|академ|жаргон|умн/i.test(reasonText)) {
      style.tone =
        "простой и понятный: объясняй так, чтобы понял человек вне этой темы; бытовой язык вместо терминов";
    }
    if (/вода|лишн/i.test(reasonText)) {
      style.preferredLength = "concise";
    }
    if (/вводн/i.test(reasonText)) {
      const rule =
        "Начинай ответ сразу с сути — без вводных слов («Ну», «Итак», «Давайте разберёмся»)";
      if (!style.customRules.includes(rule)) style.customRules.unshift(rule);
      saveRuleSource(rule, "feedback");
    }
    if (/не попал|не о том|мимо тем/i.test(reasonText)) {
      const rule =
        "Перечитай вопрос дважды и отвечай строго на заданную тему, не уходя в смежные области";
      if (!style.customRules.includes(rule)) style.customRules.unshift(rule);
      saveRuleSource(rule, "feedback");
    }
    if (/шаблон|клише|стандартн/i.test(reasonText)) {
      const rule =
        "Запрещены шаблонные зачины и ИИ-конструкции; начинай каждый ответ по-разному";
      if (!style.customRules.includes(rule)) style.customRules.unshift(rule);
      saveRuleSource(rule, "feedback");
    }
    style.customRules = style.customRules.slice(0, 15);
  }

  saveUserStylePreferences(style);

  // Durable mirror: every rating + style mutation is persisted to SQLite so
  // the learned state survives WebView storage clears. Fire-and-forget —
  // localStorage stays the synchronous read source.
  void (async () => {
    try {
      await mirrorFeedback(entry);
      await mirrorStyle(getUserStylePreferences());
    } catch {
      /* mirror is best-effort */
    }
  })();

  return entry;
}

export function getUserRuleSources(): Record<string, RuleSource> {
  const raw = safeLocalStorage.getItem(USER_RULE_SOURCES_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, RuleSource>)
      : {};
  } catch {
    return {};
  }
}

function saveRuleSource(rule: string, source: RuleSource): void {
  const current = getUserRuleSources();
  current[rule] = source;
  safeLocalStorage.setItem(
    USER_RULE_SOURCES_STORAGE_KEY,
    JSON.stringify(current)
  );
}

export function getRuleSource(rule: string): RuleSource {
  const trimmed = (rule || "").trim();
  const map = getUserRuleSources();
  if (map[trimmed]) return map[trimmed];

  const logs = getFeedbackLog();
  const match = logs.find(
    (entry) => entry.response === trimmed || entry.question === trimmed
  );
  if (match?.topic === "coach") return "coach";
  if (match?.topic === "manual") return "manual";
  if (match) return "feedback";
  return "manual";
}

export function addUserRule(
  rule: string,
  opts?: { source?: RuleSource }
): void {
  if (!isSelfLearningEnabled()) {
    return;
  }
  const trimmed = (rule || "").trim();
  if (!trimmed) return;

  const source: RuleSource = opts?.source ?? "coach";
  const style = getUserStylePreferences();
  style.customRules = [
    trimmed,
    ...style.customRules.filter((r) => r !== trimmed),
  ].slice(0, 20);
  saveUserStylePreferences(style);
  saveRuleSource(trimmed, source);

  const logs = getFeedbackLog();
  const entry: FeedbackEntry = {
    id: `fb-${source}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    question:
      source === "coach"
        ? "Рекомендация собеседника"
        : "Добавление правила",
    response: trimmed,
    rating: "like",
    reason:
      source === "coach"
        ? "Взято как правило из реплики собеседника (source=coach)"
        : `Добавлено правило (source=${source})`,
    topic: source,
    timestamp: Date.now(),
  };
  saveFeedbackLog([entry, ...logs]);

  void (async () => {
    try {
      await mirrorFeedback(entry);
      await mirrorStyle(style);
    } catch {
      /* mirror is best-effort */
    }
  })();
}

/** Compact snapshot of what the self-evolution learned — for the UI. */
export interface SelfEvolutionStats {
  totalEdits: number;
  likes: number;
  dislikes: number;
  tone: string;
  concise: boolean;
  favoritePatterns: string[];
  avoidPatterns: string[];
  customRules: string[];
}

export function getSelfEvolutionStats(): SelfEvolutionStats {
  const logs = getFeedbackLog();
  const style = getUserStylePreferences();
  return {
    totalEdits: logs.length,
    likes: logs.filter((l) => l.rating === "like").length,
    dislikes: logs.filter((l) => l.rating === "dislike").length,
    tone: style.tone,
    concise: style.preferredLength === "concise",
    favoritePatterns: style.favoritePatterns,
    avoidPatterns: style.avoidPatterns,
    customRules: style.customRules,
  };
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
 * Hard language rule applied globally to all responses.
 */
export const LANGUAGE_RULE = `[ЖЁСТКОЕ ПРАВИЛО ЯЗЫКА (без исключений)]
- Отвечай ТОЛЬКО на русском или английском языке — всегда на том языке, на котором задан вопрос.
- Никогда не отвечай, не вставляй слова и фразы на других языках.
- Если вопрос смешанный (RU+EN), отвечай на языке основного текста вопроса.
[/ЖЁСТКОЕ ПРАВИЛО ЯЗЫКА]`.trim();

/**
 * Resets learning state across both localStorage and SQLite.
 */
export async function resetLearning(): Promise<void> {
  safeLocalStorage.removeItem(USER_FACTS_STORAGE_KEY);
  safeLocalStorage.removeItem(USER_STYLE_STORAGE_KEY);
  safeLocalStorage.removeItem(FEEDBACK_LOG_STORAGE_KEY);
  safeLocalStorage.removeItem(USER_MARKDOWN_STORAGE_KEY);
  safeLocalStorage.removeItem(USER_RULE_SOURCES_STORAGE_KEY);
  safeLocalStorage.removeItem(USER_SPEECH_LOG_STORAGE_KEY);
  setSelfEvolutionStyleOverride(null);
  try {
    await resetSelfEvolutionDb();
  } catch {
    /* durability clear is best-effort */
  }
}

/**
 * Builds the compiled prompt injection for the Self-Evolution profile.
 *
 * `styleOverride` (optional) lets the async prompt path (useSystemAudio →
 * fetchAIResponse) inject a freshly-loaded SQLite style profile; without an
 * override the synchronous localStorage cache is used (render-path compat).
 * A one-shot module override bridges the frozen sync call site inside
 * ai-response.function.ts (cannot take arguments there).
 */
let oneShotStyleOverride: UserStylePreference | null = null;

/** Queue a style profile to be consumed by the NEXT buildSelfEvolutionPromptBlock() call. */
export function setSelfEvolutionStyleOverride(
  style: UserStylePreference | null
): void {
  oneShotStyleOverride = style;
}

export function buildSelfEvolutionPromptBlock(
  styleOverride?: UserStylePreference
): string {
  if (!isSelfLearningEnabled()) {
    return "";
  }

  const customMd = safeLocalStorage.getItem(USER_MARKDOWN_STORAGE_KEY);
  if (customMd && customMd.trim()) {
    return `[SELF-EVOLUTION PROFILE (USER.md)]\n${customMd.trim()}\n[/SELF-EVOLUTION PROFILE]`;
  }

  const style =
    styleOverride ?? oneShotStyleOverride ?? getUserStylePreferences();
  oneShotStyleOverride = null; // one-shot consume: never leak across requests
  const facts = getUserFacts();
  const logs = getFeedbackLog();
  const speechStyle = extractSpeechStyle(getUserSpeechTranscripts());

  const likesCount = logs.filter((l) => l.rating === "like").length;
  const dislikesCount = logs.filter((l) => l.rating === "dislike").length;

  const hasHistory =
    facts.length > 0 ||
    logs.length > 0 ||
    style.favoritePatterns.length > 0 ||
    style.avoidPatterns.length > 0 ||
    style.customRules.length > 0 ||
    speechStyle.fillers.length > 0;

  if (!hasHistory) {
    return "";
  }

  const factsLines = facts.map((f) => `- ${f.fact}`).join("\n");
  const favoritesLines = style.favoritePatterns
    .slice(0, 6)
    .map((p) => `- Поощряется: ${p}`)
    .join("\n");
  const avoidLines = style.avoidPatterns
    .slice(0, 8)
    .map((p) => `- Категорически избегать: ${p}`)
    .join("\n");
  const customLines = style.customRules
    .slice(0, 6)
    .map((r) => `- Личное правило: ${r}`)
    .join("\n");

  const sections: string[] = [
    `[SELF-EVOLUTION ADAPTIVE PROFILE - ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ (USER.md)]`,
    `Ты работаешь в режиме самообучения (Self-Evolution). Ты обязан максимально адаптироваться под личность, опыт и предпочтения этого конкретного пользователя (на основе ${likesCount} одобрений и ${dislikesCount} замечаний). Замечания и примеры ниже применяй НЕМЕДЛЕННО к каждому следующему ответу.`,
  ];

  if (factsLines) {
    sections.push(`\n1. БАЗА ЗНАНИЙ И ФАКТОВ О ПОЛЬЗОВАТЕЛЕ:\n${factsLines}`);
  }

  const styleBody = [
    `- Тональность: ${style.tone}`,
    `- Желаемый объем: ${style.preferredLength === "concise" ? "Максимально краткий" : "Краткий и ёмкий"} (1-3 коротких предложения, 35-50 слов max, БЕЗ ЛИШНЕЙ ВОДЫ)`,
    favoritesLines,
    avoidLines,
  ]
    .filter(Boolean)
    .join("\n");

  sections.push(`\n2. ВЫУЧЕННЫЙ СТИЛЬ И ПАТТЕРНЫ ОТВЕТОВ:\n${styleBody}`);

  if (customLines) {
    sections.push(`\n3. КАСТОМНЫЕ ПРАВИЛА:\n${customLines}`);
  }

  if (speechStyle.fillers.length > 0) {
    const fillerList = speechStyle.fillers
      .map((f) => `«${f.word}» (${f.count})`)
      .join(", ");
    sections.push(
      `\n4. РЕЧЕВЫЕ МАРКЕРЫ ПОЛЬЗОВАТЕЛЯ (Речевые маркеры пользователя):\n- Привычные разговорные связки и слова-паразиты пользователя: ${fillerList}\n- Отвечай в свободной разговорной форме, как обычно говорит пользователь, а не сухим списком достижений.\n- Кап плотности: используй не более 3 маркеров в одном ответе, вплетай их умеренно и органично.`
    );
  }

  sections.push(`\nПодстраивай каждый ответ под эту модель личности!\n[/SELF-EVOLUTION PROFILE]`);
  return sections.join("\n").trim();
}
