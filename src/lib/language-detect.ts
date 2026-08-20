export type DetectedLanguage = "russian" | "english" | null;

export function detectLanguage(text: string): DetectedLanguage {
  if (!text || !text.trim()) {
    return null;
  }
  const letters = text.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
  if (!letters) {
    return null;
  }
  const cyrillic = (letters.match(/[а-яА-ЯёЁ]/g) || []).length;
  const ratio = cyrillic / letters.length;
  if (ratio > 0.3) {
    return "russian";
  }
  return "english";
}
