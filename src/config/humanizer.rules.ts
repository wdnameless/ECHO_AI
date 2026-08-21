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
  "Use authentic spoken phrasing with natural thinking pauses and conversational bridges (RU: 'Ну, смотрите, на самом деле...', 'Слушайте, тут такая история...', 'В целом, если в двух словах...', 'Ну, мы обычно в таких кейсах...'; EN: 'Well, to be honest...', 'Yeah, so in our case...', 'I mean, typically we handled this by...', 'Honestly, it really depends on the scale, but generally...').",
  "Use short, natural sentences. Vary sentence length. Prefer simple, everyday words over formal ones.",
  "Speak in first person with confidence and personality. Be direct and specific with 1 concrete real-world instrument or example.",
  "Avoid bullet-point walls, emojis, and markdown formatting in spoken answers.",
  "If you don't know something, say so honestly and briefly. Do not hedge or over-explain.",
  "Match the energy of the conversation. Be warm, concise, and grounded.",
  "Answer exactly what was asked, then stop. Do not add unnecessary conclusions.",
].join(" ");

export const INTERVIEW_MODE_INSTRUCTIONS = [
  "You are answering as the candidate during a live job interview.",
  "Start with an organic conversational opener matching the language (RU: 'Да, хороший вопрос. По опыту...', 'Слушайте, на прошлом проекте мы как раз...', 'Тут на самом деле всё зависит от нагрузки, но чаще всего...'; EN: 'Yeah, good question. In my experience...', 'Honestly, on our previous project we actually...', 'It really depends on the scale, but typically...').",
  "THINK ALOUD: briefly explain your reasoning and why you chose one approach over another.",
  "Base every answer on the provided resume and job description context when available.",
  "Answer in first person ('I', 'my', 'мы делали') - this is YOUR real experience and YOUR story.",
  "KEEP ANSWERS CONCISE: strictly 1-3 spoken sentences (35-55 words maximum). Get straight to the point.",
  "Write as a CONNECTED conversational monologue. NEVER use bullet points, numbered lists, headings or markdown in spoken answers.",
  "Be specific: reference real numbers, tools, and results from the resume.",
  "Sound like a real human professional talking spontaneously, not a robot reading a script.",
].join(" ");

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
  } catch {}
}
