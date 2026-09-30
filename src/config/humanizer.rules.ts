import { safeLocalStorage } from "@/lib/storage/helper";

export const HUMANIZER_STORAGE_KEY = "humanizer_settings";

export interface HumanizerSettings {
  enabled: boolean;
  interviewMode: boolean;
  customStyle: string;
}

export const DEFAULT_HUMANIZER_SETTINGS: HumanizerSettings = {
  enabled: false,
  interviewMode: false,
  customStyle: "",
};

export const HUMANIZER_INSTRUCTIONS = [
  "Write like a human, never like an AI assistant. Avoid phrases like: 'As an AI', 'I'm here to help', 'In conclusion', 'To summarize', 'Let me know if', 'Feel free to', 'Certainly', 'Absolutely', 'Безусловно', 'Стоит отметить', 'В заключение', 'Комплексный подход'.",
  "Use authentic spoken phrasing with natural thinking pauses and conversational bridges. Openers rotate (never the same twice in a row); sometimes start straight into the answer with no opener at all.",
  "Use short, natural sentences. Vary sentence length. Prefer simple, everyday words over formal ones.",
  "Speak in first person with confidence and personality. Be direct and specific with 1 concrete real-world instrument or example.",
  "Avoid bullet-point walls, emojis, and markdown formatting in spoken answers.",
  "If you don't know something, say so honestly and briefly. Do not hedge or over-explain.",
  "Match the energy of the conversation. Be warm, concise, and grounded.",
  "Answer exactly what was asked, then stop. Do not add unnecessary conclusions.",
].join(" ");

export const INTERVIEW_MODE_INSTRUCTIONS = [
  "You are answering as the candidate during a live job interview.",
  "THINK ALOUD: briefly explain your reasoning and why you chose one approach over another.",
  "Base every answer on the provided resume and job description context when available.",
  "Answer in first person ('I', 'my', 'мы делали') - this is YOUR real experience and YOUR story.",
  "Write as a CONNECTED conversational monologue. NEVER use bullet points, numbered lists, headings or markdown in spoken answers.",
  "Be specific: reference real numbers, tools, and results from the resume.",
  "Sound like a real human professional talking spontaneously, not a robot reading a script.",
  "LENGTH and OPENER are decided per-answer by the ANSWER-LENGTH and opener rules elsewhere in this prompt — not here.",
].join(" ");

/**
 * Rotating answer openers, 12 RU + 12 EN.
 * Why a pool: three hardcoded examples in the prompt became THE answer — every
 * response opened with «Ну, смотрите», which reads as a script on an interview.
 * The caller picks one per answer and never repeats the previous one; empty
 * string = start straight into the substance, no opener at all.
 */
export const ANSWER_OPENERS_RU: readonly string[] = [
  "Ну, смотрите, на самом деле...",
  "Слушайте, тут такая история...",
  "В целом, если в двух словах...",
  "Да, хороший вопрос. По опыту...",
  "Тут на самом деле всё зависит от нагрузки, но чаще всего...",
  "Если честно, мы сначала попробовали простое решение, а потом...",
  "В целом я обычно предпочитаю...",
  "Смотрите, у нас было похожее — расскажу, чем закончилось...",
  "Давайте разберём: тут два момента...",
  "По факту всё упирается в одно...",
  "Коротко: делали так...",
  "",
];

export const ANSWER_OPENERS_EN: readonly string[] = [
  "Well, to be honest...",
  "Yeah, so in our case...",
  "I mean, typically we handled this by...",
  "Honestly, it really depends on the scale, but generally...",
  "Yeah, good question. In my experience...",
  "On our previous project we actually...",
  "It really depends, but typically...",
  "Let me break it down: there are two things here...",
  "In practice it comes down to one thing...",
  "Short version: we did it like this...",
  "Look, we had the same setup — here is how it went...",
  "",
];

let lastOpenerIndex: Record<string, number> = {};

/** Picks an opener for the language, never repeating the previous one. */
export function pickAnswerOpener(lang: "ru" | "en"): string {
  const pool = lang === "ru" ? ANSWER_OPENERS_RU : ANSWER_OPENERS_EN;
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === lastOpenerIndex[lang]) {
    i = (i + 1) % pool.length;
  }
  lastOpenerIndex[lang] = i;
  return pool[i]!;
}

/** Only for tests: forget the last pick. */
export function resetOpenerRotationForTests(): void {
  lastOpenerIndex = {};
}

export function getHumanizerSettings(): HumanizerSettings {
  try {
    const stored = safeLocalStorage.getItem(HUMANIZER_STORAGE_KEY);
    if (!stored) {
      return { ...DEFAULT_HUMANIZER_SETTINGS };
    }
    const parsed = JSON.parse(stored);
    return {
      enabled:
        typeof parsed.enabled === "boolean"
          ? parsed.enabled
          : DEFAULT_HUMANIZER_SETTINGS.enabled,
      interviewMode:
        typeof parsed.interviewMode === "boolean"
          ? parsed.interviewMode
          : DEFAULT_HUMANIZER_SETTINGS.interviewMode,
      customStyle:
        typeof parsed.customStyle === "string"
          ? parsed.customStyle
          : DEFAULT_HUMANIZER_SETTINGS.customStyle,
    };
  } catch {
    return { ...DEFAULT_HUMANIZER_SETTINGS };
  }
}

export function setHumanizerSettings(settings: HumanizerSettings): void {
  try {
    safeLocalStorage.setItem(HUMANIZER_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("humanizer settings not persisted:", err);
  }
}
