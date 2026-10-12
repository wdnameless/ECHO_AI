import { AI_PROVIDERS } from "@/config/ai-providers.constants";
import { STORAGE_KEYS } from "@/config/constants";
import { fetchAIResponse } from "@/lib/functions/ai-response.function";
import {
  getAIProviderVariables,
  getCustomAiProviders,
} from "@/lib/storage/ai-providers";
import { safeLocalStorage } from "@/lib/storage/helper";

const MAX_RULE_WORDS = 12;

/**
 * Multi-word conversational openers, politeness padding, and ASR filler phrases
 * stripped before token-level normalization.
 */
const MULTI_WORD_FILLERS: RegExp[] = [
  /(?<=^|[^\p{L}\p{N}_])(?:я\s+)?хочу\s*,?\s*чтобы\s+ты(?=[^\p{L}\p{N}_]|$)/giu,
  /(?<=^|[^\p{L}\p{N}_])мне\s+нужно\s*,?\s*чтобы\s+ты(?=[^\p{L}\p{N}_]|$)/giu,
  /(?<=^|[^\p{L}\p{N}_])надо\s*,?\s*чтобы\s+ты(?=[^\p{L}\p{N}_]|$)/giu,
  /(?<=^|[^\p{L}\p{N}_])было\s+бы\s+(?:круто|хорошо|здорово)\s*,?\s*если\s+(?:бы\s+)?ты(?=[^\p{L}\p{N}_]|$)/giu,
  /(?<=^|[^\p{L}\p{N}_])как\s+бы(?=[^\p{L}\p{N}_]|$)/giu,
  /(?<=^|[^\p{L}\p{N}_])в\s+общем(?:-то)?(?=[^\p{L}\p{N}_]|$)/giu,
  /(?<=^|[^\p{L}\p{N}_])в\s+принципе(?=[^\p{L}\p{N}_]|$)/giu,
  /(?<=^|[^\p{L}\p{N}_])по\s+сути\s+дела(?=[^\p{L}\p{N}_]|$)/giu,
  /(?<=^|[^\p{L}\p{N}_])честно\s+говоря(?=[^\p{L}\p{N}_]|$)/giu,
  /(?<=^|[^\p{L}\p{N}_])скажем\s+так(?=[^\p{L}\p{N}_]|$)/giu,
  /\byou\s+know\b/giu,
  /\bi\s+mean\b/giu,
];

/**
 * Single-word fillers, discourse particles, and vocatives stripped when they
 * act as conversational noise.
 */
const FILLER_TOKENS: Record<string, true> = {
  ну: true,
  "ну-у": true,
  "ну-у-у": true,
  ээ: true,
  эээ: true,
  "э-э": true,
  э: true,
  эм: true,
  эмм: true,
  мм: true,
  ммм: true,
  хм: true,
  гм: true,
  ага: true,
  угу: true,
  ок: true,
  окей: true,
  кстати: true,
  слушай: true,
  слушайте: true,
  смотри: true,
  смотрите: true,
  типа: true,
  вот: true,
  значит: true,
  знаешь: true,
  знаете: true,
  понимаешь: true,
  понимаете: true,
  скажем: true,
  допустим: true,
  собственно: true,
  вообще: true,
  пожалуйста: true,
  плиз: true,
  давай: true,
  давайте: true,
  "давай-ка": true,
  просто: true,
  коллега: true,
  друг: true,
  бро: true,
  ребят: true,
  ребята: true,
  эй: true,
  алло: true,
  um: true,
  uh: true,
  er: true,
  ah: true,
  please: true,
};

/**
 * Direct imperative / 2nd-person forms mapped to Russian infinitives.
 */
const IMPERATIVE_TO_INFINITIVE: Record<string, string> = {
  углубись: "углубляться",
  углубитесь: "углубляться",
  углубляйся: "углубляться",
  углубляйтесь: "углубляться",
  отвечай: "отвечать",
  отвечайте: "отвечать",
  ответь: "отвечать",
  ответьте: "отвечать",
  говори: "говорить",
  говорите: "говорить",
  скажи: "сказать",
  скажите: "сказать",
  расскажи: "рассказать",
  расскажите: "рассказать",
  рассказывай: "рассказывать",
  рассказывайте: "рассказывать",
  объясни: "объяснить",
  объясните: "объяснить",
  объясняй: "объяснять",
  объясняйте: "объяснять",
  пиши: "писать",
  пишите: "писать",
  напиши: "написать",
  напишите: "написать",
  приведи: "привести",
  приведите: "привести",
  приводи: "приводить",
  приводите: "приводить",
  используй: "использовать",
  используйте: "использовать",
  сфокусируйся: "сфокусироваться",
  сфокусируйтесь: "сфокусироваться",
  фокусируйся: "фокусироваться",
  фокусируйтесь: "фокусироваться",
  держись: "держаться",
  держитесь: "держаться",
  начинай: "начинать",
  начинайте: "начинать",
  начни: "начинать",
  начните: "начинать",
  сокращай: "сокращать",
  сокращайте: "сокращать",
  сократи: "сократить",
  сократите: "сократить",
  укорачивай: "укорачивать",
  укорачивайте: "укорачивать",
  укороти: "укоротить",
  укоротите: "укоротить",
  избегай: "избегать",
  избегайте: "избегать",
  добавь: "добавить",
  добавьте: "добавить",
  добавляй: "добавлять",
  добавляйте: "добавлять",
  покажи: "показать",
  покажите: "показать",
  показывай: "показывать",
  показывайте: "показывать",
  делай: "делать",
  делайте: "делать",
  сделай: "сделать",
  сделайте: "сделать",
  переходи: "переходить",
  переходите: "переходить",
  перейди: "перейти",
  перейдите: "перейти",
  структурируй: "структурировать",
  структурируйте: "структурировать",
  аргументируй: "аргументировать",
  аргументируйте: "аргументировать",
  сравни: "сравнить",
  сравните: "сравнить",
  сравнивай: "сравнивать",
  сравнивайте: "сравнивать",
  упомяни: "упомянуть",
  упомяните: "упомянуть",
  упоминай: "упоминать",
  упоминайте: "упоминать",
  раскрой: "раскрыть",
  раскройте: "раскрыть",
  раскрывай: "раскрывать",
  раскрывайте: "раскрывать",
  выдели: "выделить",
  выделите: "выделить",
  выделяй: "выделять",
  выделяйте: "выделять",
  лей: "лить",
  лейте: "лить",
  читай: "читать",
  читайте: "читать",
  шути: "шутить",
  шутите: "шутить",
  спеши: "спешить",
  спешите: "спешить",
  торопись: "торопиться",
  торопитесь: "торопиться",
  умничай: "умничать",
  умничайте: "умничать",
  растекайся: "растекаться",
  растекайтесь: "растекаться",
  повторяй: "повторять",
  повторяйте: "повторять",
  повторяйся: "повторяться",
  повторяйтесь: "повторяться",
  уходи: "уходить",
  уходите: "уходить",
  забывай: "забывать",
  забывайте: "забывать",
  рассуждай: "рассуждать",
  рассуждайте: "рассуждать",
  перечисляй: "перечислять",
  перечисляйте: "перечислять",
  описывай: "описывать",
  описывайте: "описывать",
  детализируй: "детализировать",
  детализируйте: "детализировать",
  резюмируй: "резюмировать",
  резюмируйте: "резюмировать",
  называй: "называть",
  называйте: "называть",
  придумывай: "придумывать",
  придумывайте: "придумывать",
  растягивай: "растягивать",
  растягивайте: "растягивать",
  грузи: "грузить",
  грузите: "грузить",
  сыпь: "сыпать",
  сыпьте: "сыпать",
  старайся: "стараться",
  старайтесь: "стараться",
  опирайся: "опираться",
  опирайтесь: "опираться",
};

function normalizeVerbToken(word: string): string {
  const lower = word.toLowerCase().replace(/ё/g, "е");
  return IMPERATIVE_TO_INFINITIVE[lower] ?? word;
}

const TRAILING_DANGLING_WORDS: Record<string, true> = {
  и: true,
  а: true,
  но: true,
  или: true,
  да: true,
  что: true,
  чтобы: true,
  как: true,
  в: true,
  на: true,
  с: true,
  со: true,
  к: true,
  по: true,
  о: true,
  об: true,
  про: true,
  без: true,
  для: true,
  из: true,
  от: true,
  до: true,
  не: true,
  ни: true,
};

function capWords(text: string, maxWords = MAX_RULE_WORDS): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length <= maxWords) return tokens.join(" ");
  const sliced = tokens.slice(0, maxWords);
  while (sliced.length > 1) {
    const lastClean = sliced[sliced.length - 1]
      .replace(/[,.:;!?—\-]+$/g, "")
      .toLowerCase();
    if (TRAILING_DANGLING_WORDS[lastClean]) {
      sliced.pop();
    } else {
      break;
    }
  }
  return sliced
    .join(" ")
    .replace(/[,.:;!?—\-]+$/g, "")
    .trim();
}

/**
 * Synchronously extracts a normalized rule candidate (infinitive form, ≤12 words,
 * stripped of vocatives and ASR fillers).
 */
export function extractRuleCandidate(utterance: string): string {
  if (!utterance || !utterance.trim()) return "";

  let text = utterance
    .trim()
    .replace(/^[«"'“„`\s]+|[»"'”`\s]+$/g, "");

  for (const pattern of MULTI_WORD_FILLERS) {
    text = text.replace(pattern, " ");
  }

  // Split into clauses/tokens preserving comma boundaries
  const rawTokens = text
    .replace(/([,.;!?]+)/g, " $1 ")
    .split(/\s+/)
    .filter(Boolean);

  const filteredTokens: string[] = [];
  let prevLower = "";

  for (const tok of rawTokens) {
    if (/^[,.;!?]+$/.test(tok)) {
      if (
        filteredTokens.length > 0 &&
        !/^[,.;!?]+$/.test(filteredTokens[filteredTokens.length - 1])
      ) {
        filteredTokens.push(",");
      }
      continue;
    }

    const clean = tok.replace(/^[^\p{L}\p{N}-]+|[^\p{L}\p{N}-]+$/gu, "");
    if (!clean) continue;

    const lower = clean.toLowerCase().replace(/ё/g, "е");
    const isClauseStart =
      filteredTokens.length === 0 ||
      filteredTokens[filteredTokens.length - 1] === ",";
    if (FILLER_TOKENS[lower] || (lower === "короче" && isClauseStart)) {
      continue;
    }

    // Deduplicate ASR stutter (consecutive identical words)
    if (lower === prevLower) {
      continue;
    }
    prevLower = lower;

    filteredTokens.push(normalizeVerbToken(clean));
  }

  // Strip trailing punctuation tokens
  while (
    filteredTokens.length > 0 &&
    filteredTokens[filteredTokens.length - 1] === ","
  ) {
    filteredTokens.pop();
  }

  if (filteredTokens.length === 0) return "";

  // Reconstruct string with commas attached to preceding word
  const reconstructed = filteredTokens
    .join(" ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ",")
    .replace(/^[,.\s]+|[,.\s]+$/g, "")
    .trim();

  if (!reconstructed) return "";

  // Lowercase the leading character unless it is an acronym (2+ uppercase letters)
  const loweredFirst =
    reconstructed.length > 1 &&
    /^[А-ЯЁA-Z][а-яёa-z\s,]/u.test(reconstructed)
      ? reconstructed[0].toLowerCase() + reconstructed.slice(1)
      : reconstructed.length === 1
      ? reconstructed.toLowerCase()
      : reconstructed;

  return capWords(loweredFirst, MAX_RULE_WORDS);
}

const REFINE_SYSTEM_PROMPT =
  "Преобразуй реплику собеседника в краткое правило для ответов в инфинитиве " +
  "(не более 12 слов, с маленькой буквы, без кавычек, без обращений и слов-паразитов). " +
  "Верни ТОЛЬКО текст правила.";

/**
 * Asynchronously refines a rule candidate in the background via the active LLM provider.
 * Always falls back to the synchronous heuristic candidate on error or empty response.
 */
export async function refineRuleCandidate(candidate: string): Promise<string> {
  const fallback = extractRuleCandidate(candidate);
  if (!fallback) return "";

  try {
    const rawSelected = safeLocalStorage.getItem(
      STORAGE_KEYS.SELECTED_AI_PROVIDER
    );
    const parsedSelected = rawSelected
      ? (JSON.parse(rawSelected) as {
          provider?: string;
          variables?: Record<string, string>;
        })
      : null;
    const providerId = parsedSelected?.provider || "nullform-gateway";
    const allProviders = [...AI_PROVIDERS, ...getCustomAiProviders()];
    const provider = allProviders.find((p) => p.id === providerId);
    const selectedProvider = {
      provider: providerId,
      variables: {
        ...getAIProviderVariables(providerId),
        ...(parsedSelected?.variables ?? {}),
      },
    };

    let rawOutput = "";
    for await (const chunk of fetchAIResponse({
      provider,
      selectedProvider,
      allProviders,
      systemPrompt: REFINE_SYSTEM_PROMPT,
      userMessage: fallback,
    })) {
      rawOutput += chunk;
    }

    const cleaned = rawOutput
      .replace(/<\s*thought\s*>[\s\S]*?(?:<\s*\/thought\s*>|$)/gi, "")
      .replace(/^```[a-z]*\s*/i, "")
      .replace(/```\s*$/i, "")
      .replace(/^[-•*]\s*/, "")
      .replace(/^[«"'“„`\s]+|[»"'”`.\s]+$/g, "")
      .trim();

    if (!cleaned) return fallback;

    const normalized = extractRuleCandidate(cleaned);
    return normalized || fallback;
  } catch {
    return fallback;
  }
}
