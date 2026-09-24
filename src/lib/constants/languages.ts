export interface Language {
  value: string;
  label: string;
}

export const CHINESE_LANGUAGE_CODE = "zh";

const LANGUAGE_ALIASES = new Map([
  ["nb", "no"],
  ["fil", "tl"],
]);

export const LANGUAGES: Language[] = [
  { value: "auto", label: "Auto Detect" },
  { value: "en", label: "English" },
  { value: CHINESE_LANGUAGE_CODE, label: "Chinese" },
  { value: "zh-Hans", label: "Chinese (Simplified)" },
  { value: "zh-Hant", label: "Chinese (Traditional)" },
  { value: "yue", label: "Cantonese" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "ru", label: "Russian" },
  { value: "ko", label: "Korean" },
  { value: "fr", label: "French" },
  { value: "ja", label: "Japanese" },
  { value: "pt", label: "Portuguese" },
  { value: "tr", label: "Turkish" },
  { value: "pl", label: "Polish" },
  { value: "ca", label: "Catalan" },
  { value: "nl", label: "Dutch" },
  { value: "ar", label: "Arabic" },
  { value: "sv", label: "Swedish" },
  { value: "it", label: "Italian" },
  { value: "id", label: "Indonesian" },
  { value: "hi", label: "Hindi" },
  { value: "fi", label: "Finnish" },
  { value: "vi", label: "Vietnamese" },
  { value: "he", label: "Hebrew" },
  { value: "uk", label: "Ukrainian" },
  { value: "el", label: "Greek" },
  { value: "ms", label: "Malay" },
  { value: "cs", label: "Czech" },
  { value: "ro", label: "Romanian" },
  { value: "da", label: "Danish" },
  { value: "hu", label: "Hungarian" },
  { value: "ta", label: "Tamil" },
  { value: "no", label: "Norwegian" },
  { value: "th", label: "Thai" },
  { value: "ur", label: "Urdu" },
  { value: "hr", label: "Croatian" },
  { value: "bg", label: "Bulgarian" },
  { value: "lt", label: "Lithuanian" },
  { value: "la", label: "Latin" },
  { value: "mi", label: "Maori" },
  { value: "ml", label: "Malayalam" },
  { value: "cy", label: "Welsh" },
  { value: "sk", label: "Slovak" },
  { value: "te", label: "Telugu" },
  { value: "fa", label: "Persian" },
  { value: "lv", label: "Latvian" },
  { value: "bn", label: "Bengali" },
  { value: "sr", label: "Serbian" },
  { value: "az", label: "Azerbaijani" },
  { value: "sl", label: "Slovenian" },
  { value: "kn", label: "Kannada" },
  { value: "et", label: "Estonian" },
  { value: "mk", label: "Macedonian" },
  { value: "br", label: "Breton" },
  { value: "eu", label: "Basque" },
  { value: "is", label: "Icelandic" },
  { value: "ga", label: "Irish" },
  { value: "hy", label: "Armenian" },
  { value: "ne", label: "Nepali" },
  { value: "mn", label: "Mongolian" },
  { value: "bs", label: "Bosnian" },
  { value: "kk", label: "Kazakh" },
  { value: "sq", label: "Albanian" },
  { value: "sw", label: "Swahili" },
  { value: "gl", label: "Galician" },
  { value: "mr", label: "Marathi" },
  { value: "pa", label: "Punjabi" },
  { value: "si", label: "Sinhala" },
  { value: "km", label: "Khmer" },
  { value: "sn", label: "Shona" },
  { value: "yo", label: "Yoruba" },
  { value: "so", label: "Somali" },
  { value: "af", label: "Afrikaans" },
  { value: "oc", label: "Occitan" },
  { value: "ka", label: "Georgian" },
  { value: "be", label: "Belarusian" },
  { value: "tg", label: "Tajik" },
  { value: "sd", label: "Sindhi" },
  { value: "gu", label: "Gujarati" },
  { value: "am", label: "Amharic" },
  { value: "yi", label: "Yiddish" },
  { value: "lo", label: "Lao" },
  { value: "uz", label: "Uzbek" },
  { value: "fo", label: "Faroese" },
  { value: "ht", label: "Haitian Creole" },
  { value: "ps", label: "Pashto" },
  { value: "tk", label: "Turkmen" },
  { value: "nn", label: "Nynorsk" },
  { value: "mt", label: "Maltese" },
  { value: "sa", label: "Sanskrit" },
  { value: "lb", label: "Luxembourgish" },
  { value: "my", label: "Myanmar" },
  { value: "bo", label: "Tibetan" },
  { value: "tl", label: "Filipino (Tagalog)" },
  { value: "mg", label: "Malagasy" },
  { value: "as", label: "Assamese" },
  { value: "tt", label: "Tatar" },
  { value: "haw", label: "Hawaiian" },
  { value: "ln", label: "Lingala" },
  { value: "ha", label: "Hausa" },
  { value: "ba", label: "Bashkir" },
  { value: "jw", label: "Javanese" },
  { value: "su", label: "Sundanese" },
];

const CHINESE_OUTPUT_INTENTS = new Set(["zh-Hans", "zh-Hant"]);

const LANGUAGE_LABELS = new Map(
  LANGUAGES.map((language) => [language.value, language.label] as const)
);

export const MODEL_CAPABILITY_LANGUAGES: Language[] = LANGUAGES.filter(
  (language) =>
    language.value !== "auto" && !CHINESE_OUTPUT_INTENTS.has(language.value)
);

export const getLanguageLabel = (languageCode: string): string | undefined => {
  return LANGUAGE_LABELS.get(languageCode);
};

export const recognitionLanguage = (languageCode: string): string => {
  const separatorIndex = languageCode.indexOf("-");
  const baseCode =
    separatorIndex === -1 ? languageCode : languageCode.slice(0, separatorIndex);

  return LANGUAGE_ALIASES.get(baseCode) ?? baseCode;
};

export const supportsLanguageCode = (
  supportedLanguages: string[] | undefined | null,
  languageCode: string
): boolean => {
  if (!supportedLanguages || !Array.isArray(supportedLanguages)) return false;
  const recognitionCode = recognitionLanguage(languageCode);
  return supportedLanguages.some(
    (supportedLanguage) =>
      recognitionLanguage(supportedLanguage) === recognitionCode
  );
};

export const getUniqueCapabilityLanguages = (
  supportedLanguages: string[] | undefined | null
): string[] => {
  if (!supportedLanguages || !Array.isArray(supportedLanguages)) return [];
  const seen = new Set<string>();
  return supportedLanguages
    .map(recognitionLanguage)
    .filter((languageCode) => {
      if (seen.has(languageCode)) return false;
      seen.add(languageCode);
      return true;
    });
};

/**
 * Picker entries that at least one model in the catalogue actually speaks.
 *
 * Offering the full language list meant 38 of 100 entries could only ever return
 * an empty result — no model in the catalogue speaks Irish, Tamil, Latin and so
 * on. A filter whose every choice yields nothing reads as a broken filter, so the
 * picker shows what the catalogue has. Codes are compared after alias
 * resolution, so a `nb` model satisfies the Norwegian entry.
 */
export const getAvailableCapabilityLanguages = (
  models: ReadonlyArray<{ languages?: string[] }>
): Language[] => {
  const reachable = new Set<string>();
  for (const model of models) {
    for (const code of getUniqueCapabilityLanguages(model.languages)) {
      reachable.add(code);
    }
  }
  return MODEL_CAPABILITY_LANGUAGES.filter((language) =>
    reachable.has(recognitionLanguage(language.value))
  );
};
