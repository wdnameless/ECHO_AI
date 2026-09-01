/**
 * Transcript stabilization and spoken filler helpers.
 *
 * Requirements:
 * 1) Streaming transcripts must not flicker, jump, or disappear while speaking.
 * 2) My microphone transcript is displayed in UI as a speech row, but NEVER automatically sent to AI.
 * 3) An explicit "Ask AI" action allows manually sending my transcribed voice (or selected phrase) to AI.
 * 4) Organic Russian interview starter fillers are provided to bridge the 1-5 second inference delay.
 */

export type TranscriptSource = "me" | "them" | "ai";

export interface TranscriptUtterance {
  id: string;
  source: TranscriptSource;
  text: string;
  partial: boolean;
  timestamp: number;
  finalKey?: string;
  rawText?: string;
}

export interface UtteranceUpsertOptions {
  source: TranscriptSource;
  text: string;
  partial: boolean;
  timestamp?: number;
  currentActiveId?: string | null;
}

/**
 * Organic Russian conversational fillers to say during the 1-5s model delay.
 * Tone: natural, calm, professional interview style.
 */
export const RUSSIAN_INTERVIEW_FILLERS: readonly string[] = [
  "Слушайте, да, это отличный вопрос. Давайте разберём по порядку...",
  "Да, хороший вопрос, сейчас вспомню ключевые моменты на практике...",
  "Секундочку, структурирую ответ: здесь есть пара важных нюансов...",
  "Интересный кейс. Если смотреть с точки зрения архитектуры и опыта...",
  "Да, отличная тема, как раз недавно с этим сталкивался...",
  "Секундочку, давайте пройдёмся по основным шагам решения...",
  "Слушайте, вопрос как раз в точку. Начну с главного принципа...",
  "Да, момент действительно тонкий. Сейчас разложу по полочкам...",
  "Хм, дайте-ка секунду, соберу мысли — тут есть о чём рассказать...",
  "Да-да, секунду. Тут важно понять контекст задачи, сейчас поясню...",
  "Так, интересная постановка. Давайте начну с базового подхода...",
  "Мм, да. Тут несколько слоёв: коротко пробегусь по каждому...",
  "Да, сейчас сформулирую — хочу дать точный ответ, а не общие слова...",
  "Секундочку. В моей практике это решалось так, начну с примера...",
  "Хороший вопрос. Давайте от общего к частному...",
  "Слушайте, да. Разберу на реальном кейсе, так будет нагляднее...",
  "Да, тут я могу рассказать достаточно подробно. Начну с предпосылок...",
  "Дайте секунду, прикину цифры и нюансы, чтобы не быть голословным...",
  "Так, сейчас — сформулирую коротко, потом раскрою детали...",
  "Да, тема знакомая. Есть несколько подходов, сравню их...",
  "Хм, тут я бы посмотрел с двух сторон — технической и продуктовой...",
  "Секунду, вспоминаю детали проекта, чтобы ответить предметно...",
  "Да, это частый вопрос на собеседованиях, и тут есть правильный ход...",
  "Слушайте, отличный вопрос — как раз мой профиль. Сейчас расскажу...",
  "Так-так, дайте структурировать: тут три ключевых момента...",
  "Да, секундочку, хочу ответить честно и по делу...",
  "Интересная задача. Давайте разберём по шагам, как я её решал...",
  "Да, тут есть подводные камни. Сейчас назову основные...",
  "Мм, отличный кейс для обсуждения. Начну с контекста...",
  "Да, вопрос глубокий. Отвечу по пунктам, чтобы ничего не упустить...",
  "Секундочку, подберу формулировку — важно ответить точно...",
  "Хорошо, давайте так: сначала короткий ответ, потом подробности...",
  "Слушайте, тут напрямую связано с моим последним проектом...",
  "Да, это я разбирал на практике. Сейчас приведу конкретный пример...",
  "Хм, вопрос комплексный. Давайте декомпозирую его на части...",
  "Да, секунду — хочу структурировать мысль, чтобы было понятно...",
  "Так, отличная тема для разговора. Отвечу через реальный опыт...",
  "Секунду, сверю факты по проекту, чтобы дать точную картину...",
  "Да, тут всё зависит от нагрузки и требований — сейчас объясню...",
  "Слушайте, да. Это одна из тех тем, где дьявол в деталях...",
  "Хорошая задача. Давайте от требований к реализации перейдём...",
  "Да, момент интересный. У нас это решалось элегантно, расскажу как...",
  "Так, секундочку — приведу аналогию, так будет понятнее...",
  "Хм, да. Тут важно не промахнуться с приоритетами, сейчас объясню...",
  "Да, я это делал не один раз. Начну с самого показательного кейса...",
  "Слушайте, вопрос на засыпку. Но ответ у меня есть, сейчас соберу...",
  "Да, секундочку — пробегусь по вариантам решения в голове...",
  "Интересный поворот. Давайте посмотрим на это через призму опыта...",
  "Да, тут два сценария развития событий — разберу оба...",
  "Мм, да. Сейчас подберу слова, чтобы сформулировать точно...",
  "Секундочку, это хороший повод рассказать про мой подход в целом...",
  "Да, тема обширная. Выделю главное, чтобы не уходить в детали...",
  "Хм, дайте подумать секунду — хочу ответить честно и по делу...",
  "Слушайте, да. Тут сразу видны грабли, на которые я наступал...",
  "Так, отлично. Начну с того, как это выглядит в реальных проектах...",
  "Да, вопрос по делу. Отвечу через архитектуру решения...",
  "Секундочку — хочу упомянуть пару нюансов, о которых часто забывают...",
  "Да, это базовая вещь, но с тонкостями. Сейчас всё разложу...",
  "Хм, интересный угол. Давайте посмотрим на примере из практики...",
  "Слушайте, да. И у меня есть что сказать по этому поводу...",
  "Да, секунду — соберу ответ в компактную структуру...",
];

/**
 * Returns a natural Russian filler preset based on seed or random index.
 * When seed is omitted, picks randomly while avoiding the last few used
 * phrases (no immediate repetition on consecutive answers).
 */
let recentFillerIdx: number[] = [];

export function selectRussianFiller(seedOrIndex?: number | string): string {
  const total = RUSSIAN_INTERVIEW_FILLERS.length;
  if (typeof seedOrIndex === "number" && Number.isFinite(seedOrIndex)) {
    const idx = Math.abs(Math.floor(seedOrIndex)) % total;
    return RUSSIAN_INTERVIEW_FILLERS[idx];
  }
  if (typeof seedOrIndex === "string" && seedOrIndex.length > 0) {
    let hash = 0;
    for (let i = 0; i < seedOrIndex.length; i++) {
      hash = (hash * 31 + seedOrIndex.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % total;
    return RUSSIAN_INTERVIEW_FILLERS[idx];
  }
  // Pure random with repeat avoidance: exclude the last 5 used.
  const recent = new Set(recentFillerIdx);
  let idx = Math.floor(Math.random() * total);
  let guard = 0;
  while (recent.has(idx) && guard < 20) {
    idx = Math.floor(Math.random() * total);
    guard++;
  }
  recentFillerIdx.push(idx);
  if (recentFillerIdx.length > 5) recentFillerIdx.shift();
  return RUSSIAN_INTERVIEW_FILLERS[idx];
}

/**
 * Normalizes text for comparison and deduping.
 */
export function normalizeTranscriptText(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if a string is eligible for explicit manual "Ask AI" trigger.
 */
export function isExplicitAskEligible(text?: string | null): boolean {
  if (!text) return false;
  const cleaned = text.trim();
  return cleaned.length >= 3;
}

/**
 * Deterministic unique ID generator for utterances.
 */
export function generateUtteranceId(source: TranscriptSource, ts: number = Date.now()): string {
  return `${source}-${ts}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Stabilizes streaming utterances in a list so they do not flicker or jump.
 * While partial=true, updates the existing utterance in place monotonically.
 */
export function upsertUtterance(
  existingList: TranscriptUtterance[],
  options: UtteranceUpsertOptions
): { list: TranscriptUtterance[]; activeId: string } {
  const { source, text, partial, currentActiveId } = options;
  const trimmed = text.trim();
  if (!trimmed) {
    return { list: existingList, activeId: currentActiveId || "" };
  }

  const timestamp = options.timestamp ?? Date.now();
  const normalized = normalizeTranscriptText(trimmed);
  const nextList = [...existingList];

  // Try to find existing active row for this utterance
  let targetIndex = -1;
  if (currentActiveId) {
    targetIndex = nextList.findIndex((u) => u.id === currentActiveId);
  }

  // Fallback: look for the latest partial row of same source within last 12 seconds
  if (targetIndex === -1 && partial) {
    for (let i = nextList.length - 1; i >= 0; i--) {
      const item = nextList[i];
      if (item.source === source && item.partial && Math.abs(timestamp - item.timestamp) < 12_000) {
        targetIndex = i;
        break;
      }
    }
  }

  if (targetIndex >= 0) {
    const prev = nextList[targetIndex];
    // Monotonic text guard: if new partial is shorter than previous by accident (reconnect flutter),
    // keep the longer text unless it looks like a completely new sentence.
    let nextText = trimmed;
    if (partial && prev.partial && prev.text.length > trimmed.length + 5) {
      if (normalizeTranscriptText(prev.text).startsWith(normalized)) {
        nextText = prev.text;
      }
    }

    const updated: TranscriptUtterance = {
      ...prev,
      text: nextText,
      partial,
      rawText: trimmed,
      timestamp: Math.max(prev.timestamp, timestamp),
    };
    nextList[targetIndex] = updated;
    return { list: nextList, activeId: updated.id };
  }

  // Brand new utterance row
  const newId = generateUtteranceId(source, timestamp);
  const newUtterance: TranscriptUtterance = {
    id: newId,
    source,
    text: trimmed,
    partial,
    timestamp,
    rawText: trimmed,
  };

  nextList.push(newUtterance);
  return { list: nextList, activeId: newId };
}

/**
 * Finalizes an utterance when speech end/VAD boundary is reached.
 */
export function finalizeUtterance(
  existingList: TranscriptUtterance[],
  activeId: string,
  finalText?: string
): TranscriptUtterance[] {
  if (!activeId) return existingList;
  const index = existingList.findIndex((u) => u.id === activeId);
  if (index === -1) return existingList;

  const nextList = [...existingList];
  const target = nextList[index];
  const textToSet = (finalText && finalText.trim()) || target.text;

  nextList[index] = {
    ...target,
    text: textToSet,
    partial: false,
    finalKey: `${target.source}:${normalizeTranscriptText(textToSet).slice(0, 40)}`,
  };

  return nextList;
}
