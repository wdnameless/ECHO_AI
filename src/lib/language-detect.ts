export type DetectedLanguage = "russian" | "english" | null;

const RUSSIAN_STOPWORDS: Record<string, true> = {
  // Question starters / imperatives / interrogatives
  "расскажи": true, "расскажите": true, "объясни": true, "объясните": true,
  "подскажи": true, "подскажите": true, "опиши": true, "опишите": true,
  "сравни": true, "сравните": true, "покажи": true, "покажите": true,
  "почему": true, "зачем": true, "как": true, "что": true, "где": true,
  "когда": true, "кто": true, "сколько": true, "какой": true, "какая": true,
  "какое": true, "какие": true, "каким": true, "какому": true, "каких": true, "каком": true,
  "чем": true, "чём": true, "кому": true, "кого": true, "куда": true, "откуда": true,
  // Common prepositions & markers in technical queries
  "про": true, "для": true, "при": true, "через": true, "между": true,
  "под": true, "над": true, "перед": true, "после": true,
  "можно": true, "нужно": true, "надо": true,
};

export function detectLanguage(text: string): DetectedLanguage {
  if (!text || !text.trim()) {
    return null;
  }
  const letters = text.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
  if (!letters) {
    return null;
  }

  // Check Russian stopwords and question markers before ratio
  // (e.g. Russian technical questions with many Latin terms)
  const cyrillicWords = text.toLowerCase().match(/[а-яё]+/gu);
  if (cyrillicWords) {
    for (const word of cyrillicWords) {
      if (RUSSIAN_STOPWORDS[word]) {
        return "russian";
      }
    }
  }

  const cyrillic = (letters.match(/[а-яА-ЯёЁ]/g) || []).length;
  const ratio = cyrillic / letters.length;
  if (ratio > 0.3) {
    return "russian";
  }
  return "english";
}
