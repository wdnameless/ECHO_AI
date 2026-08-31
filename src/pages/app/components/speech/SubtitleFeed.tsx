import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  CaptionsIcon,
  CheckIcon,
  CopyIcon,
  HeadphonesIcon,
  Loader2,
  MicIcon,
  PauseIcon,
  PlayIcon,
  SparklesIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fastTranslate } from "@/lib/fast-translator";
import {
  recordFeedback,
  getSelfEvolutionStats,
  type SelfEvolutionStats,
} from "@/lib/storage/user-facts";
import { formatSpokenAnswer } from "@/lib/spoken-format";
import { HoverTranslate } from "@/lib/hover-translate";
import { resolveProviderModel } from "@/lib/functions/ai-response.function";
import { Switch, Button } from "@/components";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/contexts";
import {
  getWebSearchSettings,
  saveWebSearchSettings,
} from "@/lib/web-search";
import type { ChatConversation, LiveSegment } from "@/hooks/useSystemAudio";

type FeedKind = "me" | "them" | "ai";

interface FeedEntry {
  id: string;
  kind: FeedKind;
  text: string;
  ts: number;
  streaming?: boolean;
}

// Fuzzy-overlap helpers for feed deduplication: ASR relistens resend the same
// words with slightly different punctuation/characters, so exact text keys
// don't catch everything. Normalization strips punctuation, lowercases and
// folds ё→е so "м²" noise doesn't defeat matching.
const normalizeWords = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const normalizeText = (s: string): string => normalizeWords(s).join(" ");

// Fraction of a's words present in b's word-set (0 if a is empty).
const overlapRatio = (a: string[], b: string[]): number => {
  if (a.length === 0) return 0;
  const bSet = new Set(b);
  let hits = 0;
  for (const w of a) if (bSet.has(w)) hits++;
  return hits / a.length;
};

// Hybrid answer helper: extracts starter phrase (up to 120 chars, cut at .!? or newline)
// and returns { starter, body }. If sentence is incomplete (e.g. streaming before first terminator),
// starter is null and full text is returned as body.
function splitHybridAnswer(text: string): { starter: string | null; body: string } {
  if (!text) return { starter: null, body: "" };
  const trimmed = text.trim();
  if (!trimmed) return { starter: null, body: "" };

  // Search for the first sentence terminator: ., !, ?, or newline
  const match = trimmed.match(/[\r\n]|[.!?](?=\s|$)/);
  if (!match || match.index === undefined) {
    // No complete sentence yet
    return { starter: null, body: trimmed };
  }

  const endIdx = match[0] === "\n" || match[0] === "\r" ? match.index : match.index + match[0].length;
  const potentialStarter = trimmed.slice(0, endIdx).trim();

  // Check length constraint (up to 120 chars) and non-empty
  if (potentialStarter.length > 0 && potentialStarter.length <= 120) {
    const remainingBody = trimmed.slice(endIdx).trim();
    return {
      starter: potentialStarter,
      body: remainingBody,
    };
  }

  return { starter: null, body: trimmed };
}

interface SubtitleFeedProps {
  conversation: ChatConversation;
  liveSegments: LiveSegment[];
  lastAIResponse: string;
  isAIProcessing: boolean;
  theirLastTranscription: string;
  micSpeaking: boolean;
  handyOnline: boolean;
  handyModel: string;
  onDeepen?: () => void;
  feedPaused: boolean;
  onTogglePause: () => void;
  lastTTFT?: number;
  pipelineError?: string;
  pendingQuestion?: string | null;
  onAskAI?: (
    utteranceId: string,
    text: string,
    source: "me" | "them"
  ) => Promise<void>;
  activeFiller?: string | null;
  pendingUtteranceId?: string | null;
}

const DISLIKE_REASONS = [
  "Слишком длинно / много воды",
  "Слишком сухо / роботизировано",
  "Слишком сложно / академично",
  "Не попал в тему вопроса",
  "Лишние вводные слова",
  "Шаблонный зачин / ИИ-клише",
  "Отвечает не на мой вопрос",
  "Слишком коротко, не хватает деталей",
  "Звучит как лекция, а не как человек",
  "Много терминов, нужно проще",
  "Нет конкретики и примеров",
  "Повторяет то, что уже было сказано",
];

const KIND_BADGE: Record<FeedKind, { label: string; cls: string }> = {
  me: {
    label: "Вы",
    cls: "text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/30",
  },
  them: {
    label: "Собеседник",
    cls: "text-primary bg-primary/10 border-primary/30",
  },
  ai: {
    label: "Ответ ИИ",
    cls: "text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/30",
  },
};

export const SubtitleFeed = ({
  conversation,
  liveSegments,
  lastAIResponse,
  isAIProcessing,
  theirLastTranscription,
  micSpeaking,
  handyOnline,
  handyModel,
  onDeepen,
  feedPaused,
  onTogglePause,
  lastTTFT,
  pipelineError,
  pendingQuestion,
  onAskAI,
  activeFiller,
  pendingUtteranceId,
}: SubtitleFeedProps) => {
  const { promptProfiles, activeProfileId, selectPromptProfile, selectedAIProvider, allAiProviders } = useApp();
  const activeProfile =
    promptProfiles.find((p) => p.id === activeProfileId) || promptProfiles[0];
  // LLM model name for the footer (e.g. "gemini-3.1-flash-lite").
  // Shared resolver: the selected `model` variable always wins over a literal
  // model string in the provider curl; the inline regex fallback is gone.
  const llmModel = resolveProviderModel(
    allAiProviders.find((p) => p.id === selectedAIProvider?.provider),
    selectedAIProvider
  );
  const [webSearchOn, setWebSearchOn] = useState<boolean>(
    () => getWebSearchSettings().enabled
  );
  const toggleWebSearch = useCallback(() => {
    setWebSearchOn((prev) => {
      const next = !prev;
      saveWebSearchSettings({ ...getWebSearchSettings(), enabled: next });
      return next;
    });
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const translatedKeysRef = useRef<Set<string>>(new Set());
  const [translationsOn, setTranslationsOn] = useState(true);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState<
    Record<string, "like" | "dislike">
  >({});
  const [dislikeMenuFor, setDislikeMenuFor] = useState<string | null>(null);
  const [customReason, setCustomReason] = useState("");
  const [evolutionNote, setEvolutionNote] = useState<string | null>(null);
  const [showBrain, setShowBrain] = useState(false);
  const [evoStats, setEvoStats] = useState<SelfEvolutionStats>(() =>
    getSelfEvolutionStats()
  );
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  // Reading freeze: while paused the feed shows a snapshot so the user can
  // read in peace; new content keeps accumulating and appears on resume.
  const frozenRef = useRef<FeedEntry[] | null>(null);
  const [heldCount, setHeldCount] = useState(0);
  const paused = feedPaused;

  // Stable timestamp for the in-flight AI row so it never jumps position.
  const liveAiTsRef = useRef<number>(0);
  useEffect(() => {
    if (isAIProcessing && !liveAiTsRef.current) liveAiTsRef.current = Date.now();
    if (!isAIProcessing) liveAiTsRef.current = 0;
  }, [isAIProcessing]);

  // Chronological feed, rendered INVERTED: newest row at the top so fresh
  // questions/answers are always visible without any scrolling.
  const entries = useMemo<FeedEntry[]>(() => {
    const map = new Map<string, FeedEntry>();
    // Normalized-text keys of entries that already landed as FINALS. A live
    // preview whose content already has a final row never re-inserts itself
    // over it (the final supersedes the preview).
    const finalizedKeys = new Set<string>();
    const push = (e: FeedEntry) => {
      if (e.id === "live-ai-answer") {
        // The in-flight AI row grows token by token: ONE fixed key so it
        // updates in place instead of stacking prefix rows.
        const prev = map.get("live-ai-answer");
        if (!prev || prev.streaming) map.set("live-ai-answer", e);
        return;
      }
      const textKey = `${e.kind}:${normalizeText(e.text).slice(0, 40)}`;
      if (e.streaming) {
        // Streaming identity = stable per-utterance id (one id per channel's
        // live text, kept by appendLiveSegment while text grows). Keying by
        // text would change every few words → row disappears/reappears
        // (flicker). The stable id updates ONE row in place.
        if (finalizedKeys.has(textKey)) return; // final already landed
        map.set(`live:${e.kind}:${e.id}`, e);
        return;
      }
      finalizedKeys.add(textKey);
      const prev = map.get(textKey);
      if (!prev || prev.streaming) map.set(textKey, e);
    };

    for (const m of conversation.messages) {
      if (!m.content?.trim()) continue;
      if (m.role === "assistant") {
        push({ id: m.id, kind: "ai", text: m.content, ts: m.timestamp });
      } else if (m.source) {
        push({ id: m.id, kind: m.source, text: m.content, ts: m.timestamp });
      }
    }
    for (const seg of liveSegments) {
      if (!seg.text?.trim()) continue;
      push({
        id: seg.id,
        kind: seg.source,
        text: seg.text,
        ts: seg.timestamp,
        streaming: seg.partial,
      });
    }
    if (isAIProcessing && lastAIResponse?.trim()) {
      push({
        id: "live-ai-answer",
        kind: "ai",
        text: lastAIResponse,
        ts: liveAiTsRef.current || Date.now(),
        streaming: true,
      });
    }

    const collected = Array.from(map.values()).sort((a, b) => a.ts - b.ts);

    // Unified fuzzy-overlap merge: consecutive rows of the same kind within a
    // per-kind time window that overlap lexically ARE the same utterance
    // (ASR re-listens, follow-up fragments, spoken pauses). The LONGER text
    // wins (a later final usually supersedes its live prefix), ts goes to the
    // max, and the id to the later row.
    const mergeWindows: Record<FeedKind, number> = {
      me: 15_000,
      them: 20_000,
      ai: 20_000,
    };
    const merged: FeedEntry[] = [];
    for (const e of collected) {
      const last = merged[merged.length - 1];
      // Streaming rows are NEVER merged: the live row must keep updating in
      // place while text grows; merge can collapse it once it finalizes.
      if (
        last &&
        !last.streaming &&
        !e.streaming &&
        e.kind === last.kind &&
        e.ts - last.ts <= (mergeWindows[last.kind] ?? 0)
      ) {
        const aWords = normalizeWords(last.text);
        const bWords = normalizeWords(e.text);
        const overlap = overlapRatio(aWords, bWords);
        const contains =
          bWords.length > 0 &&
          normalizeText(e.text).includes(normalizeText(last.text));
        if (overlap >= 0.6 || contains) {
          const later = e.ts >= last.ts ? e : last;
          last.text = e.text.length >= last.text.length ? e.text : last.text;
          last.ts = Math.max(last.ts, e.ts);
          last.id = later.id;
          last.streaming = later.streaming;
          continue;
        }
      }
      merged.push({ ...e });
    }

    return merged
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 80);
  }, [conversation.messages, liveSegments, lastAIResponse, isAIProcessing]);

  // What is actually on screen: live feed, or the frozen snapshot while paused.
  const visible = useMemo<FeedEntry[]>(() => {
    if (!paused) return entries;
    return frozenRef.current ?? entries;
  }, [paused, entries]);

  // Snapshot the feed at the moment the freeze starts.
  useEffect(() => {
    if (feedPaused) {
      frozenRef.current = entries;
    } else {
      frozenRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedPaused]);

  // Count rows that arrived while the feed is frozen.
  useEffect(() => {
    if (!paused) {
      setHeldCount(0);
      return;
    }
    const frozenKeys = new Set(
      (frozenRef.current ?? []).map((e) => `${e.kind}:${e.text.trim().toLowerCase()}`)
    );
    const fresh = entries.filter(
      (e) => !frozenKeys.has(`${e.kind}:${e.text.trim().toLowerCase()}`)
    ).length;
    setHeldCount(fresh);
  }, [entries, paused]);

  const togglePause = useCallback(() => {
    onTogglePause();
  }, [onTogglePause]);

  // Deepen always unpauses first: the user wants to see the extended answer.
  const handleDeepen = useCallback(() => {
    if (paused) {
      frozenRef.current = null;
      setHeldCount(0);
      onTogglePause();
    }
    onDeepen?.();
  }, [paused, onTogglePause, onDeepen]);

  // Translation queue: newest entries first (they are on screen), two
  // parallel workers keep latency low without hammering the endpoint.
  useEffect(() => {
    if (!translationsOn) return;
    let cancelled = false;

    const pending = entries
      .filter((e) => {
        const key = e.text.trim();
        // The user's own rows are NOT translated: the right column is for
        // interviewer questions and AI answers. Saves requests and keeps
        // the important translations instant.
        return (
          key &&
          e.kind !== "me" &&
          !e.streaming &&
          !translatedKeysRef.current.has(key) &&
          translations[key] === undefined
        );
      })
      // Interviewer questions and AI answers translate first.
      .sort((a, b) => b.ts - a.ts);

    if (pending.length === 0) return;

    const worker = async (queue: typeof pending, offset: number) => {
      for (let i = offset; i < queue.length; i += 2) {
        if (cancelled) return;
        const e = queue[i];
        const key = e.text.trim();
        translatedKeysRef.current.add(key);
        const translated = await fastTranslate(key);
        if (cancelled) return;
        setTranslations((p) => ({ ...p, [key]: translated }));
      }
    };

    void worker(pending, 0);
    void worker(pending, 1);

    return () => {
      cancelled = true;
    };
  }, [entries, translationsOn]);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  // Self-evolution: nearest interviewer phrase is the question context.
  const questionContextFor = useCallback(
    (idx: number) => {
      for (let i = idx - 1; i >= 0; i--) {
        if (entries[i].kind === "them") return entries[i].text;
      }
      return theirLastTranscription || "General conversation";
    },
    [entries, theirLastTranscription]
  );

  const showEvolutionNote = useCallback((msg: string) => {
    setEvolutionNote(msg);
    setTimeout(() => setEvolutionNote(null), 4000);
  }, []);

  const giveFeedback = useCallback(
    (
      entryId: string,
      answer: string,
      rating: "like" | "dislike",
      reason?: string
    ) => {
      const question = questionContextFor(
        entries.findIndex((e) => e.id === entryId)
      );
      recordFeedback(question, answer, rating, reason);
      setFeedbackGiven((prev) => ({ ...prev, [entryId]: rating }));
      setDislikeMenuFor(null);
      setCustomReason("");
      setEvoStats(getSelfEvolutionStats());
      showEvolutionNote(
        rating === "like"
          ? "Стиль закреплён по этому ответу"
          : `Добавлено правило избегать: ${reason ?? "этот подход"}`
      );
    },
    [entries, questionContextFor, showEvolutionNote]
  );

  // Session stats: recognized words + AI answers across the conversation.
  const sessionStats = useMemo(() => {
    let words = 0;
    let answers = 0;
    for (const e of entries) {
      if (e.kind === "ai") {
        answers++;
        words += e.text.split(/\s+/).filter(Boolean).length;
      } else {
        words += e.text.split(/\s+/).filter(Boolean).length;
      }
    }
    return { words, answers };
  }, [entries]);

  return (
    <div className="relative flex flex-col h-full min-h-0 w-full min-w-0 select-text">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-border/40 shrink-0 select-none">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Active prompt profile switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 text-[0.62em] gap-1 max-w-[130px] shrink-0"
                title="Профиль промпта (стиль и роль ответов)"
              >
                <CaptionsIcon className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {activeProfile?.name || "Профиль"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="text-[0.7em]">
              {promptProfiles.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => selectPromptProfile(p.id)}
                  className={cn(
                    "gap-1",
                    p.id === activeProfileId && "bg-primary/10 font-medium"
                  )}
                >
                  {p.id === activeProfileId && <CheckIcon className="w-3 h-3" />}
                  <span className="truncate">{p.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="text-[0.65em] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1 shrink-0">
            <CaptionsIcon className="w-3 h-3 hidden" />
          </span>
          {appVersion && (
            <span
              className="font-mono text-[0.6em] text-muted-foreground/60 shrink-0"
              title="Версия приложения Pluely"
            >
              v{appVersion}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          {pendingQuestion && (
            <span
              className="h-5 inline-flex items-center px-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-[0.62em] font-medium text-amber-700 dark:text-amber-300 shrink-0"
              title={pendingQuestion}
            >
              ⏳ вопрос в очереди
            </span>
          )}
          {onDeepen && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDeepen}
              disabled={isAIProcessing}
              className="h-5 px-1.5 text-[0.62em] gap-1 shrink-0 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
              title="Продолжить углубляться в текущую тему"
            >
              <SparklesIcon className="w-3 h-3" />
              Углубить тему
            </Button>
          )}
          <Button
            size="sm"
            variant={webSearchOn ? "default" : "ghost"}
            onClick={toggleWebSearch}
            className={cn(
              "h-5 px-1.5 text-[0.62em] gap-1 shrink-0",
              !webSearchOn && "text-muted-foreground hover:text-foreground"
            )}
            title="Веб-поиск для актуальных ответов (работает параллельно, не тормозит первый токен)"
          >
            🌐
            <span>Поиск</span>
          </Button>
          <Button
            size="sm"
            variant={paused ? "default" : "ghost"}
            onClick={togglePause}
            className={cn(
              "h-5 px-1.5 text-[0.62em] gap-1 shrink-0",
              paused
                ? "bg-amber-500 hover:bg-amber-600 text-white"
                : "text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
            )}
            title={
              paused
                ? "Возобновить ленту и показать всё накопленное"
                : "Заморозить ленту, чтобы спокойно дочитать ответ"
            }
          >
            {paused ? (
              <PlayIcon className="w-3 h-3" />
            ) : (
              <PauseIcon className="w-3 h-3" />
            )}
            {paused ? "Продолжить" : "Читаю"}
            {paused && heldCount > 0 && ` (+${heldCount})`}
          </Button>
          <DropdownMenu
            open={showBrain}
            onOpenChange={setShowBrain}
          >
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 text-[0.62em] gap-1 shrink-0"
                title="Что ИИ выучил из ваших оценок"
              >
                🧠
                {evoStats.totalEdits > 0 && (
                  <span className="font-mono">{evoStats.totalEdits}</span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-2 text-[0.68em] space-y-1.5">
              <div className="font-semibold uppercase tracking-wider text-[0.8em] text-muted-foreground border-b border-border/40 pb-1">
                Self-Evolution · что учтено · всего правок: {evoStats.totalEdits}
              </div>
              <div className="text-muted-foreground">
                👍 {evoStats.likes} · 👎 {evoStats.dislikes} · тон:{" "}
                <span className="text-foreground">{evoStats.tone}</span>
                {evoStats.concise && (
                  <span className="text-primary"> · максимально кратко</span>
                )}
              </div>
              {evoStats.favoritePatterns.length > 0 && (
                <div>
                  <div className="font-semibold text-emerald-600 dark:text-emerald-400 mb-0.5">
                    Эталоны стиля:
                  </div>
                  {evoStats.favoritePatterns.map((p, i) => (
                    <div key={i} className="truncate text-foreground/80" title={p}>
                      • {p}
                    </div>
                  ))}
                </div>
              )}
              {evoStats.avoidPatterns.length > 0 && (
                <div>
                  <div className="font-semibold text-red-500 mb-0.5">
                    Избегать:
                  </div>
                  {evoStats.avoidPatterns.map((p, i) => (
                    <div key={i} className="truncate text-foreground/80" title={p}>
                      • {p}
                    </div>
                  ))}
                </div>
              )}
              {evoStats.customRules.length > 0 && (
                <div>
                  <div className="font-semibold text-violet-500 mb-0.5">
                    Личные правила:
                  </div>
                  {evoStats.customRules.map((r, i) => (
                    <div key={i} className="truncate text-foreground/80" title={r}>
                      • {r}
                    </div>
                  ))}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <label className="flex items-center gap-1 text-[0.62em] text-muted-foreground cursor-pointer shrink-0">
            <LanguagesInline on={translationsOn} />
            Перевод
            <Switch
              checked={translationsOn}
              onCheckedChange={setTranslationsOn}
            />
          </label>
        </div>
      </div>

      {/* Freeze banner */}
      {paused && (
        <div className="flex items-center justify-between gap-2 px-2 py-1 bg-amber-500/10 border-b border-amber-500/40 text-[0.65em] text-amber-800 dark:text-amber-300 shrink-0 select-none">
          <span className="flex items-center gap-1 font-medium">
            <PauseIcon className="w-3 h-3" />
            Лента на паузе — можно спокойно читать
            {heldCount > 0 && ` · новых записей: ${heldCount}`}
          </span>
          <button
            onClick={togglePause}
            className="font-semibold underline underline-offset-2 hover:no-underline"
          >
            показать всё
          </button>
        </div>
      )}

      {/* Self-evolution acknowledgment banner */}
      {evolutionNote && (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border-b border-emerald-500/30 text-[0.65em] text-emerald-700 dark:text-emerald-300 shrink-0 animate-in fade-in slide-in-from-top-1">
          <CheckIcon className="w-3 h-3 shrink-0" />
          {evolutionNote} — подход изменён для следующего ответа
        </div>
      )}

      {/* Column headers (only when translation is on) */}
      {translationsOn && (
        <div className="grid grid-cols-[1fr_1fr] gap-x-2 px-2 py-0.5 border-b border-border/30 text-[0.6em] font-semibold uppercase tracking-wider text-muted-foreground/70 shrink-0">
          <span>Оригинал</span>
          <span className="flex items-center gap-1">
            Перевод
            {isAIProcessing && (
              <Loader2 className="w-2.5 h-2.5 animate-spin text-violet-500" />
            )}
          </span>
        </div>
      )}

      {/* Feed (inverted: newest on top) */}
      <div
        ref={scrollRef}
        className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-1 space-y-1"
      >
        {visible.length === 0 && !isAIProcessing && (
          <div className="h-full flex items-center justify-center text-muted-foreground/60 text-[0.75em] text-center px-4">
            Нажмите запись и говорите — реплики, ответы ИИ и их перевод будут
            появляться здесь.
          </div>
        )}

        {/* Immediate "thinking" row so the answer surface appears instantly */}
        {isAIProcessing &&
          !lastAIResponse?.trim() &&
          !entries.some((e) => e.kind === "ai" && e.streaming) && (
            <div className="flex items-center gap-2 py-2 px-2 text-violet-500 animate-pulse text-[0.78em]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Думаю над ответом…
            </div>
          )}

        {visible.map((e) => {
          const badge = KIND_BADGE[e.kind];
          const key = e.text.trim();
          const rowId = e.id;
          const translation = e.streaming ? undefined : translations[key];
          const isAI = e.kind === "ai";
          const fb = feedbackGiven[e.id];

          if (isAI) {
            /* Prominent AI answer card */
            return (
              <div
                key={rowId}
                className={cn(
                  "relative rounded-lg border p-2 space-y-1 transition-shadow",
                  "border-violet-500/40 bg-violet-500/5 shadow-[0_0_0_1px_rgba(139,92,246,0.08)]",
                  e.streaming && "opacity-90"
                )}
              >
                <div className="flex items-center justify-between text-[0.6em]">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-semibold px-1 py-px rounded border uppercase tracking-wide",
                      badge.cls
                    )}
                  >
                    <SparklesIcon className="w-2.5 h-2.5" />
                    {badge.label}
                  </span>
                  <div className="flex items-center gap-0.5">
                    {fb ? (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium px-1">
                        <CheckIcon className="w-3 h-3" />
                        {fb === "like" ? "паттерн усвоен" : "учтено"}
                      </span>
                    ) : (
                      !e.streaming && (
                        <div className="flex items-center gap-0.5 relative">
                          {onDeepen && (
                            <button
                              className="p-0.5 rounded hover:bg-violet-500/10 text-muted-foreground hover:text-violet-500"
                              title="Углубить эту тему: продолжить рассказ"
                              onClick={handleDeepen}
                            >
                              <SparklesIcon className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            className="p-0.5 rounded hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-500"
                            title="Лайк: закрепить стиль ответа"
                            onClick={() => giveFeedback(e.id, e.text, "like")}
                          >
                            <ThumbsUpIcon className="w-3 h-3" />
                          </button>
                          <button
                            className="p-0.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500"
                            title="Дизлайк: указать, что улучшить"
                            onClick={() =>
                              setDislikeMenuFor((v) =>
                                v === e.id ? null : e.id
                              )
                            }
                          >
                            <ThumbsDownIcon className="w-3 h-3" />
                          </button>
                          {dislikeMenuFor === e.id && (
                            <div className="absolute right-0 top-5 z-40 w-72 rounded-lg border border-border/80 bg-background/95 p-1.5 shadow-lg text-[10px] space-y-0.5 animate-in fade-in duration-100 max-h-80 overflow-y-auto">
                              <div className="px-2 py-1 font-semibold text-muted-foreground border-b border-border/40 uppercase tracking-wider text-[8px]">
                                Что улучшить в ответах?
                              </div>
                              {DISLIKE_REASONS.map((reason) => (
                                <button
                                  key={reason}
                                  onClick={() =>
                                    giveFeedback(e.id, e.text, "dislike", reason)
                                  }
                                  className="w-full text-left px-2 py-1 rounded hover:bg-muted text-foreground/90 transition-colors"
                                >
                                  {reason}
                                </button>
                              ))}
                              <div className="border-t border-border/40 pt-1 mt-1 flex items-center gap-1 px-1">
                                <input
                                  value={customReason}
                                  onChange={(ev) =>
                                    setCustomReason(ev.target.value)
                                  }
                                  onKeyDown={(ev) => {
                                    if (ev.key === "Enter" && customReason.trim()) {
                                      giveFeedback(
                                        e.id,
                                        e.text,
                                        "dislike",
                                        customReason.trim()
                                      );
                                    }
                                  }}
                                  placeholder="Своя причина…"
                                  className="flex-1 min-w-0 bg-transparent border border-border/60 rounded px-1.5 py-0.5 text-[10px] outline-none focus:border-primary/60"
                                />
                                <button
                                  onClick={() => {
                                    if (customReason.trim()) {
                                      giveFeedback(
                                        e.id,
                                        e.text,
                                        "dislike",
                                        customReason.trim()
                                      );
                                    }
                                  }}
                                  className="px-1 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20"
                                  title="Отправить"
                                >
                                  ✓
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    )}
                    <button
                      onClick={() => handleCopy(rowId, e.text)}
                      className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:opacity-100 text-muted-foreground hover:text-foreground"
                      title="Скопировать ответ"
                    >
                      {copiedId === rowId ? (
                        <CheckIcon className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <CopyIcon className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                {(() => {
                  const { starter, body } = splitHybridAnswer(e.text);
                  return (
                    <div className="space-y-2">
                      {starter && (
                        <div className="rounded-md bg-violet-500/10 border border-violet-500/30 px-2.5 py-1.5 shadow-sm">
                          <div className="text-[0.62em] font-semibold text-violet-400 uppercase tracking-wider mb-0.5">
                            Главная мысль
                          </div>
                          <div
                            className="text-[0.98em] font-medium leading-snug text-foreground"
                            style={{
                              wordBreak: "break-word",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {e.streaming ? starter : <HoverTranslate text={starter} />}
                          </div>
                        </div>
                      )}
                      <div
                        className={cn(
                          "grid gap-x-2",
                          translationsOn ? "grid-cols-[1fr_1fr]" : "grid-cols-1"
                        )}
                      >
                        <div
                          className="min-w-0 text-[0.86em] leading-relaxed text-foreground space-y-1.5"
                          style={{
                            wordBreak: "break-word",
                            overflowWrap: "anywhere",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {body
                            ? formatSpokenAnswer(body).map((p, i) => (
                                <p key={i} className="leading-relaxed">
                                  {e.streaming ? p : <HoverTranslate text={p} />}
                                </p>
                              ))
                            : !starter && (
                                <p className="leading-relaxed">
                                  {e.streaming ? e.text : <HoverTranslate text={e.text} />}
                                </p>
                              )}
                        </div>
                        {translationsOn && (
                          <div className="min-w-0 flex items-start border-l border-border/30 pl-2">
                            {e.streaming ? (
                              <Loader2 className="w-3 h-3 animate-spin text-violet-400/70 mt-1" />
                            ) : translation === undefined ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin text-muted-foreground/50 mt-1" />
                            ) : (
                              <p
                                className="text-[0.8em] leading-relaxed text-violet-700/90 dark:text-violet-300/90"
                                style={{
                                  wordBreak: "break-word",
                                  overflowWrap: "anywhere",
                                  whiteSpace: "pre-wrap",
                                }}
                              >
                                {translation}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          }

          /* Compact speech rows (me / them) */
          const isPending = pendingUtteranceId === e.id;
          const showAskAI = e.kind === "me" && !e.streaming && Boolean(onAskAI);
          const isAskDisabled = !e.text.trim() || isPending || isAIProcessing;
          const showFillerBelow = isPending && Boolean(activeFiller);

          return (
            <div key={rowId} className="space-y-0.5">
              <div
                className={cn(
                  "group grid gap-x-2 py-0.5 border-b border-border/20 hover:bg-muted/30 rounded transition-colors",
                  translationsOn ? "grid-cols-[1fr_1fr]" : "grid-cols-1"
                )}
              >
                <div className="min-w-0 flex items-start gap-1.5">
                  <span
                    className={cn(
                      "shrink-0 mt-px inline-flex items-center gap-0.5 text-[0.56em] font-semibold px-1 py-px rounded border uppercase tracking-wide",
                      badge.cls
                    )}
                  >
                    {e.kind === "me" ? (
                      <MicIcon className="w-2.5 h-2.5" />
                    ) : (
                      <HeadphonesIcon className="w-2.5 h-2.5" />
                    )}
                    {badge.label}
                  </span>
                  <p
                    className={cn(
                      "flex-1 min-w-0 text-[0.76em] leading-snug break-words",
                      e.kind === "me"
                        ? "text-foreground/80"
                        : "text-foreground/95 font-medium",
                      e.streaming && "italic text-muted-foreground"
                    )}
                    style={{
                      wordBreak: "break-word",
                      overflowWrap: "anywhere",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {e.streaming ? (
                      e.text
                    ) : (
                      <HoverTranslate text={e.text} />
                    )}
                  </p>
                  {showAskAI && (
                    <button
                      type="button"
                      onClick={() => onAskAI?.(e.id, e.text, "me")}
                      disabled={isAskDisabled}
                      className={cn(
                        "shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.62em] font-medium transition-colors border",
                        "text-violet-600 dark:text-violet-300 border-violet-500/30 hover:bg-violet-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500",
                        "disabled:opacity-40 disabled:pointer-events-none"
                      )}
                      aria-label="Спросить ИИ"
                      title="Спросить ИИ"
                    >
                      <SparklesIcon className="w-2.5 h-2.5" />
                      Спросить ИИ
                    </button>
                  )}
                  <button
                    onClick={() => handleCopy(rowId, e.text)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground mt-0.5"
                    title="Скопировать"
                  >
                    {copiedId === rowId ? (
                      <CheckIcon className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <CopyIcon className="w-3 h-3" />
                    )}
                  </button>
                </div>
                {translationsOn && (
                  <div className="min-w-0 flex items-start">
                    {e.streaming ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin text-muted-foreground/40 mt-0.5" />
                    ) : e.kind === "me" ? (
                      <span className="text-muted-foreground/30 text-[0.7em] mt-0.5">—</span>
                    ) : translation === undefined ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin text-muted-foreground/40 mt-0.5" />
                    ) : (
                      <p
                        className="flex-1 min-w-0 text-[0.72em] leading-snug text-primary/75 break-words"
                        style={{
                          wordBreak: "break-word",
                          overflowWrap: "anywhere",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {translation}
                      </p>
                    )}
                  </div>
                )}
              </div>
              {showFillerBelow && (
                <div
                  className="flex items-center gap-1.5 py-1 px-2 rounded border border-violet-500/20 bg-violet-500/5 text-violet-600 dark:text-violet-300 text-[0.72em]"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                  <span className="truncate">{activeFiller}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Status footer */}
      <div className="flex items-center justify-between gap-2 px-2 py-0.5 border-t border-border/40 text-[0.6em] text-muted-foreground shrink-0">
        <span className="flex items-center gap-2 min-w-0">
          {micSpeaking && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              слушаю…
            </>
          )}
          <span
            title="Сессия: слов распознано · ответов ИИ"
            className="font-mono shrink-0"
          >
            {sessionStats.words} слов · {sessionStats.answers} отв.
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
        {handyOnline && (
          <span
            className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium"
            title={`Локальная модель: ${handyModel || "Nemotron 3.5 ASR (GPU)"}`}
          >
            🎧 Nemotron GPU · RU/EN
            {handyModel && (
              <span className="font-mono text-emerald-600/70 dark:text-emerald-400/70">
                {handyModel}
              </span>
            )}
          </span>
        )}
        {lastTTFT !== undefined && lastTTFT > 0 && (
          <span
            className={cn(
              "font-mono",
              lastTTFT < 800
                ? "text-emerald-600 dark:text-emerald-400"
                : lastTTFT < 2000
                ? "text-amber-600 dark:text-amber-400"
                : "text-red-500"
            )}
            title="Время до первого токена ответа ИИ (скорость провайдера)"
          >
            ⏱ {lastTTFT}мс
          </span>
        )}
        {llmModel && (
          <span
            className="font-mono text-violet-600/80 dark:text-violet-400/80"
            title="Модель ИИ, которая отвечает"
          >
            🤖 {llmModel}
          </span>
        )}
        </span>
        {pipelineError && (
          <div
            className="absolute bottom-full left-0 right-0 mb-1 flex items-center gap-1.5 px-2 py-1 rounded-md border border-red-500/40 bg-red-500/10 text-[0.65em] text-red-700 dark:text-red-300 shadow-lg z-10"
            title="Последняя ошибка пайплайна"
          >
            <span className="shrink-0 font-semibold">⚠ Ошибка:</span>
            <span className="min-w-0 flex-1 truncate">{pipelineError}</span>
          </div>
        )}
      </div>
    </div>
  );
};

/* Small inline indicator next to the translation switch */
const LanguagesInline = ({ on }: { on: boolean }) => (
  <span
    className={cn(
      "inline-block w-1.5 h-1.5 rounded-full",
      on ? "bg-emerald-500" : "bg-muted-foreground/40"
    )}
  />
);
