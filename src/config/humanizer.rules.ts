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
  "Write like a human, never like an AI assistant. Avoid phrases like: 'As an AI', 'I'm here to help', 'In conclusion', 'To summarize', 'Let me know if', 'Feel free to', 'Certainly', 'Absolutely'.",
  "Use short, natural sentences. Vary sentence length. Prefer simple, everyday words over formal ones.",
  "Speak in first person with confidence and personality. Be direct and specific.",
  "Avoid bullet-point walls, emojis, and markdown formatting in spoken answers.",
  "If you don't know something, say so honestly and briefly. Do not hedge or over-explain.",
  "Match the energy of the conversation. Be warm, concise, and grounded.",
  "Answer exactly what was asked, then stop. Do not add unnecessary conclusions.",
].join(" ");

export const INTERVIEW_MODE_INSTRUCTIONS = [
  "You are answering as the candidate during a job interview.",
  "Base every answer on the provided resume and job description context when available.",
  "Answer in first person ('I', 'my') - this is YOUR experience and YOUR story.",
  "Keep answers under 60-90 seconds of spoken time (roughly 150-220 words).",
  "Be specific: reference real numbers, tools, and results from the resume.",
  "If the question is technical, show your reasoning briefly, then give the answer.",
  "Never say 'according to my resume' or 'based on the job description' - just answer naturally.",
  "Sound like a real professional talking, not a robot reading a script.",
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
