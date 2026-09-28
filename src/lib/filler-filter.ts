import { safeLocalStorage } from "./storage/helper";

export interface FillerFilterConfig {
  /** Filter fillers when forwarding to AI prompts/Auto-Ask (default: true) */
  filterAiEnabled: boolean;
  /** Filter fillers when displaying transcripts in the conversation feed (default: false) */
  filterFeedEnabled: boolean;
  /** Custom comma-separated filler words/phrases */
  customFillers: string;
}

export const FILLER_FILTER_STORAGE_KEYS = {
  FILTER_AI_ENABLED: "filler_filter_ai_enabled",
  FILTER_FEED_ENABLED: "filler_filter_feed_enabled",
  CUSTOM_FILLERS: "filler_filter_custom_words",
} as const;

export const DEFAULT_FILLER_FILTER_CONFIG: FillerFilterConfig = {
  filterAiEnabled: true,
  filterFeedEnabled: false,
  customFillers: "",
};

/**
 * Built-in default Russian and English filler words & multi-word expressions.
 */
export const DEFAULT_FILLER_WORDS_RU = [
  "ээ",
  "эээ",
  "эм",
  "эмм",
  "э-э",
  "э",
  "ну",
  "ну-у",
  "ну-у-у",
  "типа",
  "как бы",
  "короче",
  "вот",
  "гм",
  "хм",
  "мм",
  "ммм",
];

export const DEFAULT_FILLER_WORDS_EN = [
  "um",
  "uh",
  "er",
  "ah",
  // No "like": a token filter cannot tell the verb from the filler, and
  // "I like it" -> "I it" destroys meaning while a leaked "like" is noise.
  // Whoever wants it filtered adds it via custom fillers.
  "you know",
  "i mean",
  "uh-huh",
  "mhm",
  "mm-hmm",
];

export const ALL_DEFAULT_FILLERS = [
  ...DEFAULT_FILLER_WORDS_RU,
  ...DEFAULT_FILLER_WORDS_EN,
];

export function getFillerFilterConfig(): FillerFilterConfig {
  const aiRaw = safeLocalStorage.getItem(FILLER_FILTER_STORAGE_KEYS.FILTER_AI_ENABLED);
  const feedRaw = safeLocalStorage.getItem(FILLER_FILTER_STORAGE_KEYS.FILTER_FEED_ENABLED);
  const customRaw = safeLocalStorage.getItem(FILLER_FILTER_STORAGE_KEYS.CUSTOM_FILLERS);

  return {
    filterAiEnabled: aiRaw !== null ? aiRaw === "true" : DEFAULT_FILLER_FILTER_CONFIG.filterAiEnabled,
    filterFeedEnabled: feedRaw !== null ? feedRaw === "true" : DEFAULT_FILLER_FILTER_CONFIG.filterFeedEnabled,
    customFillers: customRaw !== null ? customRaw : DEFAULT_FILLER_FILTER_CONFIG.customFillers,
  };
}

export function saveFillerFilterConfig(config: Partial<FillerFilterConfig>): FillerFilterConfig {
  const current = getFillerFilterConfig();
  const next: FillerFilterConfig = {
    filterAiEnabled: typeof config.filterAiEnabled === "boolean" ? config.filterAiEnabled : current.filterAiEnabled,
    filterFeedEnabled: typeof config.filterFeedEnabled === "boolean" ? config.filterFeedEnabled : current.filterFeedEnabled,
    customFillers: typeof config.customFillers === "string" ? config.customFillers : current.customFillers,
  };

  safeLocalStorage.setItem(FILLER_FILTER_STORAGE_KEYS.FILTER_AI_ENABLED, String(next.filterAiEnabled));
  safeLocalStorage.setItem(FILLER_FILTER_STORAGE_KEYS.FILTER_FEED_ENABLED, String(next.filterFeedEnabled));
  safeLocalStorage.setItem(FILLER_FILTER_STORAGE_KEYS.CUSTOM_FILLERS, next.customFillers);

  return next;
}

/**
 * Escapes regex special characters in a string literal.
 */
function escapeRegex(text: string): string {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/**
 * Normalizes punctuation and whitespace after removing filler tokens.
 * E.g. "Привет, , мир !" -> "Привет, мир!"
 * ", мир" -> "Мир" (or "мир")
 * " , " -> ""
 */
export function normalizePunctuationAndWhitespace(text: string): string {
  if (!text) return "";

  let result = text;

  // Deduplicate commas separated by spaces or other commas: ", ," or ",  ," -> ", "
  result = result.replace(/,\s*(?:,\s*)+/g, ", ");

  // Collapse spaces before commas, periods, exclamation marks, question marks, colons, semicolons
  result = result.replace(/\s+([,.:;!?])/g, "$1");

  // Collapse consecutive commas: "word,, text" -> "word, text"
  result = result.replace(/,\s*,+/g, ",");
  result = result.replace(/([,;])\s*([.!?])/g, "$2");

  // Collapse multiple whitespace characters into a single space
  result = result.replace(/\s+/g, " ");

  // Remove leading commas/colons/semicolons/dots left behind if a filler was at the beginning
  result = result.replace(/^[,;:\s]+/, "");

  // Remove trailing commas/colons/semicolons left behind if a filler was at the end
  result = result.replace(/[,;:\s]+$/, "");

  // Trim whitespace
  result = result.trim();

  return result;
}
export class FillerFilterService {
  private fillerPatterns: RegExp[] = [];

  constructor(customFillers?: string | string[]) {
    this.updateFillers(customFillers);
  }

  /**
   * Updates compiled regex patterns with default + custom filler terms.
   */
  public updateFillers(custom?: string | string[]) {
    const customList: string[] = [];
    if (typeof custom === "string") {
      customList.push(
        ...custom
          .split(",")
          .map((w) => w.trim())
          .filter(Boolean)
      );
    } else if (Array.isArray(custom)) {
      customList.push(...custom.map((w) => w.trim()).filter(Boolean));
    }

    // Combine unique fillers and sort longer multi-word phrases first to prevent partial masking
    const all = Array.from(new Set([...ALL_DEFAULT_FILLERS, ...customList]))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    this.fillerPatterns = all.map((filler) => {
      const lower = filler.toLowerCase().trim();
      const escaped = escapeRegex(lower);

      // "ну" is a discourse particle as well as a filler: "ну-ка" and "ну же"
      // are legitimate speech, a bare "ну" between pauses is not. The negative
      // lookahead keeps the former and removes the latter.
      if (lower === "ну") {
        return new RegExp(
          `(?<=^|[\\s,.:;!?"'«»()—\\[\\]{}/<>-])${escaped}(?![-]|\\s+же(?=[\\s,.:;!?"'«»()—\\[\\]{}/<>-]|$))(?=$|[\\s,.:;!?"'«»()—\\[\\]{}/<>-])`,
          "gi"
        );
      }

      // Hyphen-safe boundaries: "-" is no longer a terminator but a guard.
      // Old pattern cut "ну-ка" to "-ка" and "letter" would break the same way
      // for any filler ending inside a hyphenated word. Lookbehind is ES2018+;
      // target is ES2020, so this holds in all our runtimes.
      const boundaryStart = lower.startsWith("-")
        ? `(?<=^|[\\s,.:;!?"'«»()—\\[\\]{}/<>])`
        : `(?<=^|[\\s,.:;!?"'«»()—\\[\\]{}/<>])(?<!-)`;

      const boundaryEnd = lower.endsWith("-")
        ? `(?=$|[\\s,.:;!?"'«»()—\\[\\]{}/<>])`
        : `(?!-)(?=$|[\\s,.:;!?"'«»()—\\[\\]{}/<>])`;

      return new RegExp(`${boundaryStart}${escaped}${boundaryEnd}`, "gi");
    });
  }

  /**
   * Strips filler words from input text and cleans up punctuation/whitespace.
   */
  public filter(text: string): string {
    if (!text || !text.trim()) return "";

    let processed = text;
    for (const pattern of this.fillerPatterns) {
      processed = processed.replace(pattern, "");
    }

    return normalizePunctuationAndWhitespace(processed);
  }
}

/**
 * Singleton / default instance initialized with current config.
 */
let defaultFilterService: FillerFilterService | null = null;

export function getFillerFilterService(): FillerFilterService {
  if (!defaultFilterService) {
    const config = getFillerFilterConfig();
    defaultFilterService = new FillerFilterService(config.customFillers);
  }
  return defaultFilterService;
}

/**
 * Convenience helper to filter text using the current or provided config.
 */
export function filterFillers(text: string, customFillers?: string): string {
  if (customFillers !== undefined) {
    const service = new FillerFilterService(customFillers);
    return service.filter(text);
  }
  return getFillerFilterService().filter(text);
}
