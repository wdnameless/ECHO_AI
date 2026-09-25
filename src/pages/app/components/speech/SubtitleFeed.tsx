import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptionsIcon,
  CheckIcon,
  CopyIcon,
  HeadphonesIcon,
  Loader2,
  MicIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  SparklesIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fastTranslate } from "@/lib/fast-translator";
import { useAppVersion } from "@/lib/version";
import { getMetrics, onMetrics, resetMetrics } from "@/lib/metrics";
import {
  recordFeedback,
  getSelfEvolutionStats,
  type SelfEvolutionStats,
} from "@/lib/storage/user-facts";
import { formatSpokenAnswer } from "@/lib/spoken-format";
import { HoverTranslate } from "@/lib/hover-translate";
import { resolveProviderModel } from "@/lib/functions/ai-response.function";
import { addCorrection, applyCorrections } from "@/lib/vocab";
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
import { detectTextLanguage } from "@/lib/transcript-stabilizer";

/**
 * Newest text spoken by the interviewer, preferring the live feed (fresher than
 * the stored conversation) and falling back to the last stored question.
 * Used to pick the language of the on-screen filler placeholder.
 */
function newestInterviewerText(
  liveSegments: LiveSegment[],
  messages: ChatConversation["messages"]
): string {
  for (let i = liveSegments.length - 1; i >= 0; i--) {
    const seg = liveSegments[i];
    if (seg.source === "them" && seg.text.trim()) return seg.text;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.source === "them" && msg.content?.trim()) return msg.content;
  }
  return "";
}

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


interface SubtitleFeedProps {
  conversation: ChatConversation;
  liveSegments: LiveSegment[];
  lastAIResponse: string;
  isAIProcessing: boolean;
  theirLastTranscription: string;
  micSpeaking: boolean;
  handyOnline: boolean;
  handyModel: string;
  wsReconnects?: number;
  lostSegments?: number;
  lastSttDurationMs?: number;
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
  onCorrectWord?: (id: string, newText: string) => void;
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

const StreamingAiRow = memo(function StreamingAiRow({
  text,
  copied,
  onCopy,
}: {
  text: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const badge = KIND_BADGE["ai"];
  return (
    <div
      className={cn(
        "relative rounded-lg border p-2 space-y-1 transition-shadow",
        "border-violet-500/40 bg-violet-500/5 shadow-[0_0_0_1px_rgba(139,92,246,0.08)] opacity-90"
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
          <button
            onClick={onCopy}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:opacity-100 text-muted-foreground hover:text-foreground"
            title="Скопировать ответ"
          >
            {copied ? (
              <CheckIcon className="w-3 h-3 text-emerald-500" />
            ) : (
              <CopyIcon className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      <div className="grid gap-x-2 w-full min-w-0 max-w-full grid-cols-1">
        <div
          className="min-w-0 text-[0.86em] leading-relaxed text-foreground space-y-1.5"
          style={{
            wordBreak: "break-word",
            overflowWrap: "anywhere",
            whiteSpace: "pre-wrap",
          }}
        >
          {formatSpokenAnswer(text).map((p, i) => (
            <p key={i} className="leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
});

const AiFeedRow = memo(function AiFeedRow({
  id,
  text,
  streaming,
  feedback,
  translation,
  translationsOn,
  copied,
  isDislikeOpen,
  customReason,
  onCopy,
  onDeepen,
  onFeedback,
  onToggleDislike,
  onCustomReasonChange,
}: {
  id: string;
  text: string;
  streaming?: boolean;
  feedback?: "like" | "dislike";
  translation?: string;
  translationsOn: boolean;
  copied: boolean;
  isDislikeOpen: boolean;
  customReason: string;
  onCopy: (id: string, text: string) => void;
  onDeepen?: () => void;
  onFeedback: (
    id: string,
    text: string,
    rating: "like" | "dislike",
    reason?: string
  ) => void;
  onToggleDislike: (id: string) => void;
  onCustomReasonChange: (val: string) => void;
}) {
  const badge = KIND_BADGE["ai"];
  return (
    <div
      className={cn(
        "relative rounded-lg border p-2 space-y-1 transition-shadow",
        "border-violet-500/40 bg-violet-500/5 shadow-[0_0_0_1px_rgba(139,92,246,0.08)]",
        streaming && "opacity-90"
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
          {feedback ? (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium px-1">
              <CheckIcon className="w-3 h-3" />
              {feedback === "like" ? "паттерн усвоен" : "учтено"}
            </span>
          ) : (
            !streaming && (
              <div className="flex items-center gap-0.5 relative">
                {onDeepen && (
                  <button
                    className="p-0.5 rounded hover:bg-violet-500/10 text-muted-foreground hover:text-violet-500"
                    title="Углубить эту тему: продолжить рассказ"
                    onClick={onDeepen}
                  >
                    <SparklesIcon className="w-3 h-3" />
                  </button>
                )}
                <button
                  className="p-0.5 rounded hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-500"
                  title="Лайк: закрепить стиль ответа"
                  onClick={() => onFeedback(id, text, "like")}
                >
                  <ThumbsUpIcon className="w-3 h-3" />
                </button>
                <button
                  className="p-0.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500"
                  title="Дизлайк: указать, что улучшить"
                  onClick={() => onToggleDislike(id)}
                >
                  <ThumbsDownIcon className="w-3 h-3" />
                </button>
                {isDislikeOpen && (
                  <div className="absolute right-0 top-5 z-40 w-72 rounded-lg border border-border/80 bg-background/95 p-1.5 shadow-lg text-[10px] space-y-0.5 animate-in fade-in duration-100 max-h-80 overflow-y-auto">
                    <div className="px-2 py-1 font-semibold text-muted-foreground border-b border-border/40 uppercase tracking-wider text-[8px]">
                      Что улучшить в ответах?
                    </div>
                    {DISLIKE_REASONS.map((reason) => (
                      <button
                        key={reason}
                        onClick={() => onFeedback(id, text, "dislike", reason)}
                        className="w-full text-left px-2 py-1 rounded hover:bg-muted text-foreground/90 transition-colors"
                      >
                        {reason}
                      </button>
                    ))}
                    <div className="border-t border-border/40 pt-1 mt-1 flex items-center gap-1 px-1">
                      <input
                        value={customReason}
                        onChange={(ev) => onCustomReasonChange(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" && customReason.trim()) {
                            onFeedback(id, text, "dislike", customReason.trim());
                          }
                        }}
                        placeholder="Своя причина…"
                        className="flex-1 min-w-0 bg-transparent border border-border/60 rounded px-1.5 py-0.5 text-[10px] outline-none focus:border-primary/60"
                      />
                      <button
                        onClick={() => {
                          if (customReason.trim()) {
                            onFeedback(id, text, "dislike", customReason.trim());
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
            onClick={() => onCopy(id, text)}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:opacity-100 text-muted-foreground hover:text-foreground"
            title="Скопировать ответ"
          >
            {copied ? (
              <CheckIcon className="w-3 h-3 text-emerald-500" />
            ) : (
              <CopyIcon className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-x-2 w-full min-w-0 max-w-full",
          translationsOn && !streaming ? "grid-cols-2" : "grid-cols-1"
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
          {formatSpokenAnswer(text).map((p, i) => (
            <p key={i} className="leading-relaxed">
              {streaming ? p : <HoverTranslate text={p} />}
            </p>
          ))}
        </div>
        {translationsOn && !streaming && (
          <div className="min-w-0 flex items-start border-l border-border/30 pl-2">
            {translation === undefined ? (
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
});

const SpeechFeedRow = memo(function SpeechFeedRow({
  id,
  kind,
  text,
  streaming,
  translation,
  translationsOn,
  isEditing,
  editWrongWord,
  editRightWord,
  editInputRef,
  isSavingCorrection,
  showAskAI,
  isAskDisabled,
  showFillerBelow,
  activeFiller,
  copied,
  onCopy,
  onAskAI,
  onStartInlineEdit,
  onCancelInlineEdit,
  onSaveInlineEdit,
  onEditRightWordChange,
}: {
  id: string;
  kind: "me" | "them";
  text: string;
  streaming?: boolean;
  translation?: string;
  translationsOn: boolean;
  isEditing: boolean;
  editWrongWord: string;
  editRightWord: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  isSavingCorrection: boolean;
  showAskAI: boolean;
  isAskDisabled: boolean;
  showFillerBelow: boolean;
  activeFiller?: string | null;
  copied: boolean;
  onCopy: (id: string, text: string) => void;
  onAskAI?: (utteranceId: string, text: string, source: "me" | "them") => Promise<void>;
  onStartInlineEdit: (rowId: string, text: string, sel?: string) => void;
  onCancelInlineEdit: () => void;
  onSaveInlineEdit: (originalText: string, wrongWord: string, rightWord: string) => void;
  onEditRightWordChange: (val: string) => void;
}) {
  const badge = KIND_BADGE[kind];
  return (
    <div className="space-y-0.5">
      <div
        className={cn(
          "group grid gap-x-2 py-0.5 border-b border-border/20 hover:bg-muted/30 rounded transition-colors w-full min-w-0 max-w-full",
          translationsOn ? "grid-cols-2" : "grid-cols-1"
        )}
      >
        <div className="flex items-start gap-1.5 min-w-0 overflow-hidden">
          <span
            className={cn(
              "shrink-0 mt-px inline-flex items-center gap-0.5 text-[0.56em] font-semibold px-1 py-px rounded border uppercase tracking-wide",
              badge.cls
            )}
          >
            {kind === "me" ? (
              <MicIcon className="w-2.5 h-2.5" />
            ) : (
              <HeadphonesIcon className="w-2.5 h-2.5" />
            )}
            {badge.label}
          </span>

          {isEditing ? (
            <div className="flex-1 min-w-0 flex flex-col gap-1 py-0.5">
              <div className="flex items-center gap-1">
                <span
                  className="shrink-0 h-6 px-1.5 inline-flex items-center text-[0.72em] font-medium text-muted-foreground bg-muted/50 border border-border rounded"
                  title="Распознано (не редактируется)"
                >
                  {editWrongWord}
                </span>
                <span className="text-[0.7em] text-muted-foreground">→</span>
                <input
                  ref={editInputRef}
                  type="text"
                  value={editRightWord}
                  onChange={(e) => onEditRightWordChange(e.target.value)}
                  placeholder="Как правильно?"
                  className="flex-1 min-w-0 h-6 px-1.5 py-0.5 text-[0.74em] font-medium bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  onKeyDown={(evt) => {
                    if (evt.key === "Escape") {
                      evt.preventDefault();
                      onCancelInlineEdit();
                    } else if (evt.key === "Enter") {
                      evt.preventDefault();
                      if (editWrongWord && editRightWord) {
                        void onSaveInlineEdit(text, editWrongWord, editRightWord);
                      }
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (editWrongWord && editRightWord) {
                      void onSaveInlineEdit(text, editWrongWord, editRightWord);
                    }
                  }}
                  disabled={isSavingCorrection || !editRightWord.trim()}
                  className="shrink-0 h-6 px-1.5 inline-flex items-center gap-1 rounded text-[0.68em] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  title="Сохранить в словарь"
                >
                  {isSavingCorrection ? (
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  ) : (
                    <CheckIcon className="w-2.5 h-2.5" />
                  )}
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={onCancelInlineEdit}
                  className="shrink-0 h-6 px-1 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  title="Отмена (Esc)"
                >
                  <XIcon className="w-3 h-3" />
                </button>
              </div>
              <span className="text-[0.62em] text-muted-foreground">
                Enter — сохранить в словарь ASR, Esc — отмена
              </span>
            </div>
          ) : (
            <p
              onMouseUp={() => {
                const sel = window.getSelection()?.toString().trim();
                if (sel && sel.split(/\s+/).length <= 4) {
                  onStartInlineEdit(id, text, sel);
                }
              }}
              className={cn(
                "flex-1 min-w-0 text-[0.76em] leading-snug break-words cursor-text",
                kind === "me"
                  ? "text-foreground/80"
                  : "text-foreground/95 font-medium",
                streaming && "italic text-muted-foreground"
              )}
              style={{
                wordBreak: "break-word",
                overflowWrap: "anywhere",
                whiteSpace: "pre-wrap",
              }}
              title="Выделите слово для исправления"
            >
              {streaming ? text : <HoverTranslate text={text} />}
            </p>
          )}

          {!isEditing && (
            <button
              type="button"
              onClick={() => onStartInlineEdit(id, text)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.62em] font-medium transition-colors border",
                "text-muted-foreground hover:text-foreground border-border/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              )}
              aria-label="Исправить"
              title="Исправить слово в словаре"
            >
              <PencilIcon className="w-2.5 h-2.5" />
              Исправить
            </button>
          )}

          {showAskAI && (
            <button
              type="button"
              onClick={() => onAskAI?.(id, text, "me")}
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
          {!isEditing && (
            <button
              onClick={() => onCopy(id, text)}
              className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground mt-0.5"
              title="Скопировать"
            >
              {copied ? (
                <CheckIcon className="w-3 h-3 text-emerald-500" />
              ) : (
                <CopyIcon className="w-3 h-3" />
              )}
            </button>
          )}
        </div>
        {translationsOn && (
          <div className="min-w-0 flex items-start">
            {translation === undefined ? (
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
});

export const SubtitleFeed = ({
  conversation,
  liveSegments,
  lastAIResponse,
  isAIProcessing,
  theirLastTranscription,
  micSpeaking,
  handyOnline,
  handyModel,
  wsReconnects,
  lostSegments,
  lastSttDurationMs,
  onDeepen,
  feedPaused,
  onTogglePause,
  lastTTFT,
  pipelineError,
  pendingQuestion,
  onAskAI,
  activeFiller,
  pendingUtteranceId,
  onCorrectWord,
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
  const appVersion = useAppVersion();
  // Recognition timings live in a store, not in props: every measured pass
  // ticks while the panel is open, and threading that through the parent hook
  // would re-render the whole tree on each tick.
  const [metrics, setMetrics] = useState(() => getMetrics());
  useEffect(() => onMetrics((m) => setMetrics(m)), []);
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

  // Word-correction overrides keyed by a STABLE text key (first 40
  // normalized chars) so a correction survives the live-to-final id change.
  const [textOverrides, setTextOverrides] = useState<Record<string, string>>({});
  const applyTextOverride = useCallback(
    (key: string, updated: string) => {
      setTextOverrides((prev) => ({ ...prev, [key]: updated }));
      onCorrectWord?.(key, updated);
    },
    [onCorrectWord]
  );
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editWrongWord, setEditWrongWord] = useState("");
  const [editRightWord, setEditRightWord] = useState("");
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  const startInlineEdit = useCallback(
    (rowId: string, currentText: string, selectedWord?: string) => {
      // Selection IS the wrong word automatically - the user only types the
      // correct form. Fall back to single-word rows when nothing selected.
      const selWord =
        (selectedWord || window.getSelection()?.toString().trim() || "").slice(0, 80);
      let wrong = selWord;
      if (!wrong) {
        const words = currentText.trim().split(/\s+/);
        wrong = words.length === 1 ? words[0] : "";
      }
      if (!wrong) return; // no target word - do not open popover
      setEditingRowId(rowId);
      setEditWrongWord(wrong);
      setEditRightWord("");
    },
    []
  );

  const cancelInlineEdit = useCallback(() => {
    setEditingRowId(null);
    setEditWrongWord("");
    setEditRightWord("");
    setIsSavingCorrection(false);
  }, []);

  const saveInlineEdit = useCallback(
    async (originalText: string, wrongWord: string, rightWord: string) => {
      const cleanWrong = wrongWord.trim();
      const cleanRight = rightWord.trim();
      if (!cleanWrong || !cleanRight) {
        cancelInlineEdit();
        return;
      }

      setIsSavingCorrection(true);
      const textKey = originalText.trim().slice(0, 40).toLowerCase();
      try {
        await addCorrection(cleanWrong, cleanRight);
        const updatedText = applyCorrections(originalText, [
          { wrong: cleanWrong, right: cleanRight },
        ]);
        applyTextOverride(textKey, updatedText);
        cancelInlineEdit();
      } catch (e) {
        console.error("Failed to add ASR correction:", e);
        // Fallback local update even if DB fails
        const escaped = cleanWrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(?<=^|[^\\p{L}\\p{N}_])${escaped}(?=[^\\p{L}\\p{N}_]|$)`, "gui");
        const updatedText = originalText.replace(regex, cleanRight);
        applyTextOverride(textKey, updatedText);
        cancelInlineEdit();
      } finally {
        setIsSavingCorrection(false);
      }
    },
    [applyTextOverride, cancelInlineEdit]
  );

  useEffect(() => {
    if (editingRowId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingRowId]);


  // Reading freeze: while paused the feed shows a snapshot so the user can
  // read in peace; new content keeps accumulating and appears on resume.
  const frozenRef = useRef<FeedEntry[] | null>(null);
  const [heldCount, setHeldCount] = useState(0);
  const paused = feedPaused;


  // Chronological feed, rendered INVERTED: newest row at the top so fresh
  // questions/answers are always visible without any scrolling.
  // The pipeline picks the spoken filler in the question's language, but it is
  // cleared between questions. Until it arrives this row still has to show
  // something to read aloud, and that placeholder must match the language of
  // the question on screen — a Russian opener under an English question reads
  // as a script.
  const fallbackFiller = useMemo(
    () =>
      detectTextLanguage(newestInterviewerText(liveSegments, conversation.messages)) ===
      "ru"
        ? "Секундочку, сейчас сформулирую…"
        : "One second, let me put this together…",
    [liveSegments, conversation.messages]
  );

  const entries = useMemo<FeedEntry[]>(() => {
    const map = new Map<string, FeedEntry>();
    // Normalized-text keys of entries that already landed as FINALS. A live
    // preview whose content already has a final row never re-inserts itself
    // over it (the final supersedes the preview).
    const finalizedKeys = new Set<string>();
    const push = (e: FeedEntry) => {
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
  }, [conversation.messages, liveSegments]);

  // What is actually on screen: live feed, or the frozen snapshot while paused.
  // Apply any in-place user overrides (e.g. from corrections).
  const visible = useMemo<FeedEntry[]>(() => {
    const base = !paused ? entries : (frozenRef.current ?? entries);
    if (Object.keys(textOverrides).length === 0) return base;
    return base.map((e) => {
      const key = e.text.trim().slice(0, 40).toLowerCase();
      const override = textOverrides[key];
      return override !== undefined ? { ...e, text: override } : e;
    });
  }, [paused, entries, textOverrides]);

  // Snapshot the feed at the moment the freeze starts.
  useEffect(() => {
    if (feedPaused) {
      frozenRef.current = entries;
    } else {
      frozenRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedPaused]);

  // Smooth auto-scroll: the feed is inverted (newest at top). When new
  // content lands while the user is reading the top, snap-scrolling looks
  // like a violent jump - animate toward the top instead.
  const prevFeedKeyRef = useRef("");
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || paused) return;
    const newest = visible[0];
    const feedKey = newest ? newest.id : "";
    if (feedKey === prevFeedKeyRef.current) return;
    prevFeedKeyRef.current = feedKey;
    // Only auto-scroll when the user is already reading the top (hasn't
    // scrolled away into history).
    if (el.scrollTop > 100) return;
    el.scrollTo?.({ top: 0, behavior: "auto" });
  }, [visible, paused]);

  // One-shot scroll to top when AI processing begins
  const prevAiProcessingRef = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || paused) return;
    if (isAIProcessing && !prevAiProcessingRef.current) {
      if (el.scrollTop <= 100) {
        el.scrollTo?.({ top: 0, behavior: "auto" });
      }
    }
    prevAiProcessingRef.current = isAIProcessing;
  }, [isAIProcessing, paused]);

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
  //
  // Only finished rows are translated: a live row renders full width (no
  // translation column), so translating partial text would burn the endpoint
  // for something nobody can see.
  useEffect(() => {
    if (!translationsOn) return;
    let cancelled = false;

    const pending = entries
      .filter((e) => {
        const key = e.text.trim();
        // Переводим все строки, включая собственную речь: при ответе на
        // английском нужно видеть, как звучит фраза, а не прочерк. Строки
        // в процессе распознавания пропускаем — текст ещё меняется.
        return (
          key &&
          !e.streaming &&
          !translatedKeysRef.current.has(key) &&
          translations[key] === undefined
        );
      })
      // Вопросы собеседника и ответы ИИ — в первую очередь.
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

  const handleCopy = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  const toggleDislikeMenu = useCallback((id: string) => {
    setDislikeMenuFor((v) => (v === id ? null : id));
  }, []);

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

        {/* Immediate filler/thinking row or streaming AI answer (isolated cheap subtree) */}
        {!paused && isAIProcessing && (
          !lastAIResponse?.trim() ? (
            <div className="my-1.5 p-3 rounded-lg border border-violet-500/30 bg-violet-500/5 text-violet-600 dark:text-violet-300 shadow-sm transition-all animate-in fade-in">
              <div className="flex items-center gap-1.5 mb-1 text-[0.72em] font-medium text-violet-500/90 tracking-wide uppercase">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Заполните паузу (зачитайте вслух):</span>
              </div>
              <div className="text-[0.95em] font-medium leading-snug tracking-normal select-text text-foreground/90 pl-1 border-l-2 border-violet-500/60">
                «{activeFiller || fallbackFiller}»
              </div>
            </div>
          ) : (
            <StreamingAiRow
              text={lastAIResponse}
              copied={copiedId === "live-ai-answer"}
              onCopy={() => handleCopy("live-ai-answer", lastAIResponse)}
            />
          )
        )}

        {visible.map((e) => {
          const key = e.text.trim();
          const rowId = e.id;
          const translation = translations[key];
          const isAI = e.kind === "ai";

          if (isAI) {
            return (
              <AiFeedRow
                key={rowId}
                id={rowId}
                text={e.text}
                streaming={e.streaming}
                feedback={feedbackGiven[rowId]}
                translation={translation}
                translationsOn={translationsOn}
                copied={copiedId === rowId}
                isDislikeOpen={dislikeMenuFor === rowId}
                customReason={customReason}
                onCopy={handleCopy}
                onDeepen={onDeepen ? handleDeepen : undefined}
                onFeedback={giveFeedback}
                onToggleDislike={toggleDislikeMenu}
                onCustomReasonChange={setCustomReason}
              />
            );
          }

          /* Compact speech rows (me / them) */
          // `isAI` above already returned, so only speech kinds reach here; the
          // cast is what states that to the type system (FeedKind includes "ai",
          // which `SpeechFeedRow` deliberately does not accept).
          const speechKind = e.kind as "me" | "them";
          const isPending = pendingUtteranceId === e.id;
          const isEditing = editingRowId === rowId;
          const showAskAI = e.kind === "me" && !e.streaming && Boolean(onAskAI) && !isEditing;
          const isAskDisabled = !e.text.trim() || isPending || isAIProcessing;
          const showFillerBelow = isPending && Boolean(activeFiller);

          return (
            <SpeechFeedRow
              key={rowId}
              id={rowId}
              kind={speechKind}
              text={e.text}
              streaming={e.streaming}
              translation={translation}
              translationsOn={translationsOn}
              isEditing={isEditing}
              editWrongWord={editWrongWord}
              editRightWord={editRightWord}
              editInputRef={editInputRef}
              isSavingCorrection={isSavingCorrection}
              showAskAI={showAskAI}
              isAskDisabled={isAskDisabled}
              showFillerBelow={showFillerBelow}
              activeFiller={activeFiller}
              copied={copiedId === rowId}
              onCopy={handleCopy}
              onAskAI={onAskAI}
              onStartInlineEdit={startInlineEdit}
              onCancelInlineEdit={cancelInlineEdit}
              onSaveInlineEdit={saveInlineEdit}
              onEditRightWordChange={setEditRightWord}
            />
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
        {appVersion && (
          <span
            className="font-mono text-muted-foreground/70"
            title={`Версия приложения${llmModel ? ` · модель ответов: ${llmModel}` : ""}`}
          >
            v{appVersion}
          </span>
        )}
        {handyOnline && (
          <span
            className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium"
            title={`Локальная модель распознавания: ${handyModel || "Nemotron 3.5 ASR (GPU)"}`}
          >
            🎧 ASR
          </span>
        )}
        {lastSttDurationMs !== undefined && lastSttDurationMs > 0 && (
          <span
            className="font-mono text-cyan-600 dark:text-cyan-400"
            title="Длительность инференса локального STT"
          >
            🎙 {Math.round(lastSttDurationMs)}мс
          </span>
        )}
        {/* Live recognition timings: what the user waits for in practice.
            `partial` is one live re-transcription round trip, `text` is the
            delay from the start of an utterance to its first visible words. */}
        {metrics.lastPartialMs !== null && (
          <span
            className={cn(
              "font-mono",
              metrics.lastPartialMs < 200
                ? "text-emerald-600 dark:text-emerald-400"
                : metrics.lastPartialMs < 600
                ? "text-amber-600 dark:text-amber-400"
                : "text-red-500"
            )}
            title={`Живая расшифровка: последняя ${metrics.lastPartialMs}мс, средняя ${metrics.avgPartialMs ?? "-"}мс из ${metrics.partialSamplesCount} замеров`}
          >
            ⚡ {metrics.lastPartialMs}мс
          </span>
        )}
        {metrics.lastFirstTextMs !== null && (
          <span
            className={cn(
              "font-mono",
              metrics.lastFirstTextMs < 800
                ? "text-emerald-600 dark:text-emerald-400"
                : metrics.lastFirstTextMs < 2000
                ? "text-amber-600 dark:text-amber-400"
                : "text-red-500"
            )}
            title="Задержка от начала реплики до первых слов на экране"
          >
            ⏱ {metrics.lastFirstTextMs}мс
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            resetMetrics();
            setMetrics(getMetrics());
          }}
          className="font-mono text-muted-foreground/70 hover:text-foreground"
          title="Сбросить таймеры и счётчики сессии"
        >
          ⟲
        </button>
        {wsReconnects !== undefined && wsReconnects > 0 && (
          <span
            className="font-mono text-amber-600 dark:text-amber-400"
            title="Количество реконнектов WebSocket микрофона"
          >
            🔄 {wsReconnects} rec
          </span>
        )}
        {lostSegments !== undefined && lostSegments > 0 && (
          <span
            className="font-mono text-red-500"
            title="Потерянные аудио сегменты при обрыве соединения"
          >
            ⚠ {lostSegments} lost
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
