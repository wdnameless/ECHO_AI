import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircleIcon,
  CaptionsIcon,
  CheckIcon,
  CopyIcon,
  Loader2,
  PauseIcon,
  PlayIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslationQueue } from "@/hooks/useTranslationQueue";
import { useAppVersion } from "@/lib/version";
import { getMetrics, onMetrics, resetMetrics, buildMetricsDump } from "@/lib/metrics";
import { getAsrLanguage } from "@/lib/asr-language";
import { getAnswerLengthOverride } from "@/lib/answer-length-override";
import { getSpeechModelLang } from "@/hooks/useSpeechModelSwitch";
import {
  recordFeedback,
  getRuleSource,
  getSelfEvolutionStats,
  isSelfLearningEnabled,
  type SelfEvolutionStats,
} from "@/lib/storage/user-facts";
import {
  createDefaultSmartRule,
  deleteSmartRule,
  getSmartRules,
  saveSmartRule,
  type SmartRule,
} from "@/lib/storage/smart-rules";
import {
  extractRuleCandidate,
  refineRuleCandidate,
} from "@/lib/rule-extract";
import {
  BEHAVIOR_SUGGESTION_EVENT,
  confirmSuggestion,
  dismissSuggestion,
  getActiveSuggestions,
  observeElaborate,
  observeShorten,
  type BehaviorSuggestion,
} from "@/lib/behavior-watch";
import { SelfLearningToggle } from "@/components/SelfLearningToggle";
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
import { getAIProviderVariables } from "@/lib/storage/ai-providers";
import { useEffectiveProvider } from "@/hooks/useEffectiveProvider";
import { RulePreview, type RulePreviewProps } from "./feed/RulePreview";
export { RulePreview, type RulePreviewProps };
import { FeedRow, type FeedRowProps } from "./feed/FeedRow";
export { FeedRow, FeedRow as SpeechFeedRow, type FeedRowProps };
import {
  AICard,
  type AICardProps,
  ThoughtContainer,
  AnswerBody,
  splitThoughtAnswer,
  answerForCopy,
  splitCodeForCopy,
  DISLIKE_REASONS,
} from "./feed/AICard";
export {
  AICard,
  AICard as AiFeedRow,
  type AICardProps,
  type AICardProps as AiFeedRowProps,
  ThoughtContainer,
  splitThoughtAnswer,
  answerForCopy,
  splitCodeForCopy,
  DISLIKE_REASONS,
};

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
  isStalled?: boolean;
  aiStatusMessage?: string;
  stallNextId?: string;
  onStallWait?: () => void;
  onStallRetry?: () => void;
  onStallNext?: () => void;
  onOpenProviders?: () => void;
  activeProviderId?: string;
  onSetSelectedAIProvider?: (provider: {
    provider: string;
    variables: Record<string, string>;
  }) => void;
  onTakeAsRule?: (entryId: string, text: string) => void;
}


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
        <AnswerBody text={text} />
      </div>
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
  isStalled = false,
  aiStatusMessage,
  stallNextId,
  onStallWait,
  onStallRetry,
  onStallNext,
  onOpenProviders,
  activeProviderId: propActiveProviderId,
  onSetSelectedAIProvider: propOnSetSelectedAIProvider,
  onTakeAsRule: propOnTakeAsRule,
}: SubtitleFeedProps) => {
  const {
    promptProfiles,
    activeProfileId,
    selectPromptProfile,
  } = useApp();
  const {
    effectiveProviderId,
    effectiveModel: llmModel,
    allAiProviders,
    handleSelectProvider,
  } = useEffectiveProvider(propActiveProviderId, propOnSetSelectedAIProvider);

  const activeProfile =
    promptProfiles.find((p) => p.id === activeProfileId) || promptProfiles[0];
  const [webSearchOn, setWebSearchOn] = useState<boolean>(
    () => getWebSearchSettings().enabled
  );
  const [stalledSeconds, setStalledSeconds] = useState(0);

  useEffect(() => {
    if (!isStalled) {
      setStalledSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setStalledSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isStalled]);
  const toggleWebSearch = useCallback(() => {
    setWebSearchOn((prev) => {
      const next = !prev;
      saveWebSearchSettings({ ...getWebSearchSettings(), enabled: next });
      return next;
    });
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const [translationsOn, setTranslationsOn] = useState(true);
  const appVersion = useAppVersion();
  // Recognition timings live in a store, not in props: every measured pass
  // ticks while the panel is open, and threading that through the parent hook
  // would re-render the whole tree on each tick.
  const [metrics, setMetrics] = useState(() => getMetrics());
  useEffect(() => onMetrics((m) => setMetrics(m)), []);
  const [dumpCopied, setDumpCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState<
    Record<string, "like" | "dislike">
  >({});
  const [ruleTakenMap, setRuleTakenMap] = useState<Record<string, boolean>>({});
  const [rulePreview, setRulePreview] = useState<{
    entryId: string;
    quote: string;
    candidate: string;
    edited: boolean;
  } | null>(null);
  const [dislikeMenuFor, setDislikeMenuFor] = useState<string | null>(null);
  const [customReason, setCustomReason] = useState("");
  const [evolutionNote, setEvolutionNote] = useState<string | null>(null);
  const [showBrain, setShowBrain] = useState(false);
  const [evoStats, setEvoStats] = useState<SelfEvolutionStats>(() =>
    getSelfEvolutionStats()
  );
  const [smartRules, setSmartRules] = useState<SmartRule[]>(() =>
    getSmartRules()
  );
  const [behaviorSuggestions, setBehaviorSuggestions] = useState<
    BehaviorSuggestion[]
  >(() => getActiveSuggestions());

  useEffect(() => {
    const syncSuggestions = () =>
      setBehaviorSuggestions(getActiveSuggestions());
    window.addEventListener(BEHAVIOR_SUGGESTION_EVENT, syncSuggestions);
    return () =>
      window.removeEventListener(BEHAVIOR_SUGGESTION_EVENT, syncSuggestions);
  }, []);

  const handleConfirmSuggestion = useCallback((id: string) => {
    const rule = confirmSuggestion(id);
    setBehaviorSuggestions(getActiveSuggestions());
    if (rule) {
      setSmartRules(getSmartRules());
      setEvoStats(getSelfEvolutionStats());
      setEvolutionNote("Правило сохранено");
      setTimeout(() => setEvolutionNote(null), 4000);
    }
  }, []);

  const handleDismissSuggestion = useCallback((id: string) => {
    dismissSuggestion(id);
    setBehaviorSuggestions(getActiveSuggestions());
  }, []);

  const handleOpenBrainChange = useCallback((open: boolean) => {
    setShowBrain(open);
    if (open) {
      setEvoStats(getSelfEvolutionStats());
      setSmartRules(getSmartRules());
    }
  }, []);

  const handleDeleteSmartRule = useCallback((id: string) => {
    deleteSmartRule(id);
    setSmartRules(getSmartRules());
    setEvoStats(getSelfEvolutionStats());
  }, []);

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

    // A row that repeats a row already accepted must not reach the screen.
    //
    // The merge above only ever compares a row with its immediate predecessor,
    // so a row repeating an EARLIER one survives whenever anything sits between
    // them — and an AI answer is always committed between two interviewer
    // rows. The interviewer's next final also re-reads the clause already on
    // screen, because the recogniser is handed the audio of the whole
    // utterance: measured on the stored conversations, 188 of 316 adjacent
    // interviewer turns (59%) contained the previous one verbatim.
    //
    // Containment, not equality: the repeated row is a superstring of the one
    // already shown, so comparing the whole text catches it where a fixed-length
    // key cannot. The longer row is kept — it carries the new words.
    const deduped: FeedEntry[] = [];
    for (const e of merged) {
      const text = normalizeText(e.text);
      const words = text.split(" ").filter(Boolean);
      // Only rows with real content decide or are decided: a short interjection
      // ("Да.") legitimately recurs and is not a repetition.
      const covering = deduped.find(
        (kept) =>
          kept.kind === e.kind &&
          words.length > 0 &&
          normalizeText(kept.text).split(" ").filter(Boolean).length >= 3 &&
          (text.includes(normalizeText(kept.text)) ||
            normalizeText(kept.text).includes(text))
      );
      if (covering) {
        // Keep whichever row is longer; the shorter one said nothing more.
        if (text.length > normalizeText(covering.text).length) {
          covering.text = e.text;
          covering.ts = Math.max(covering.ts, e.ts);
        }
        continue;
      }
      deduped.push({ ...e });
    }

    return deduped
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
    observeElaborate();
    setBehaviorSuggestions(getActiveSuggestions());
    onDeepen?.();
  }, [paused, onTogglePause, onDeepen]);

  // The queue itself lives in a hook: its state was a ref plus a state tick
  // whose relationship was expressed nowhere, and both defects that reached
  // users came from that coupling (a failure cancelling its own workers, and a
  // result discarded during teardown). See `useTranslationQueue`.
  const { translations, hasFailed: translationFailed } = useTranslationQueue(
    entries,
    translationsOn
  );


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
      if (!isSelfLearningEnabled()) {
        setDislikeMenuFor(null);
        setCustomReason("");
        showEvolutionNote("Самообучение выключено");
        return;
      }
      const question = questionContextFor(
        entries.findIndex((e) => e.id === entryId)
      );
      const fbEntry = recordFeedback(question, answer, rating, reason);
      if (!fbEntry && rating === "dislike" && reason) {
        if (/длин|вода|лишн|короче|сократ/i.test(reason)) {
          observeShorten();
        } else if (/коротк|детал|подробн/i.test(reason)) {
          observeElaborate();
        }
      }
      setBehaviorSuggestions(getActiveSuggestions());
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

  const handleTakeAsRule = useCallback(
    (entryId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (typeof isSelfLearningEnabled === "function" && !isSelfLearningEnabled()) {
        showEvolutionNote("Самообучение выключено");
        return;
      }
      const initialCandidate = extractRuleCandidate(trimmed) || trimmed;
      setRulePreview({
        entryId,
        quote: trimmed,
        candidate: initialCandidate,
        edited: false,
      });
      void Promise.resolve(refineRuleCandidate(initialCandidate))
        .then((refined) => {
          const cleanRefined = (refined || "").trim();
          if (!cleanRefined) return;
          setRulePreview((prev) => {
            if (!prev || prev.entryId !== entryId || prev.edited) return prev;
            return { ...prev, candidate: cleanRefined };
          });
        })
        .catch(() => {});
    },
    [showEvolutionNote]
  );

  const handleSaveRulePreview = useCallback(
    (entryId: string, finalCandidate: string) => {
      const cleanText = finalCandidate.trim();
      if (!cleanText) return;
      const quote =
        rulePreview?.entryId === entryId ? rulePreview.quote : cleanText;
      const now = Date.now();
      const baseRule = createDefaultSmartRule(cleanText, "coach");
      saveSmartRule({
        ...baseRule,
        text: cleanText,
        origin: {
          source: "coach",
          quote,
          at: now,
        },
      });
      propOnTakeAsRule?.(entryId, cleanText);
      setRuleTakenMap((prev) => ({ ...prev, [entryId]: true }));
      setRulePreview(null);
      setEvoStats(getSelfEvolutionStats());
      setSmartRules(getSmartRules());
      showEvolutionNote("Совет собеседника сохранён как правило");
    },
    [propOnTakeAsRule, rulePreview, showEvolutionNote]
  );

  const handleEditRulePreview = useCallback(
    (entryId: string, editedText: string) => {
      setRulePreview((prev) => {
        if (!prev || prev.entryId !== entryId) return prev;
        return { ...prev, candidate: editedText, edited: true };
      });
    },
    []
  );

  const handleCancelRulePreview = useCallback(() => {
    setRulePreview(null);
  }, []);

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
            title="Веб-поиск для актуальных ответов (ждёт до ~1 сек перед запросом к ИИ)"
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
            onOpenChange={handleOpenBrainChange}
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
              <SelfLearningToggle variant="compact" />
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
              {smartRules.length > 0 ? (
                <div>
                  <div className="font-semibold text-violet-500 mb-0.5">
                    Личные правила:
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {smartRules.map((r) => {
                      const originLabel = r.origin.quote || r.origin.source;
                      return (
                        <div
                          key={r.id}
                          className="flex items-start justify-between gap-1 p-1 rounded bg-muted/40 text-[0.95em]"
                          data-testid={`smart-rule-${r.id}`}
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="font-medium text-foreground truncate" title={r.text}>
                              • {r.text}
                            </div>
                            <div className="flex items-center gap-1.5 text-[0.85em] text-muted-foreground flex-wrap">
                              <span
                                className="px-1 py-px rounded bg-violet-500/10 text-violet-500 shrink-0"
                                title="Источник"
                              >
                                источник: {originLabel}
                              </span>
                              <span>хиты: {r.hits}</span>
                              <span>вес: {r.weight}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteSmartRule(r.id)}
                            className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0 transition-colors"
                            title="Удалить правило"
                            aria-label={`Удалить правило ${r.text}`}
                          >
                            <Trash2Icon className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : evoStats.customRules.length > 0 ? (
                <div>
                  <div className="font-semibold text-violet-500 mb-0.5">
                    Личные правила:
                  </div>
                  {evoStats.customRules.map((r, i) => {
                    const src =
                      typeof getRuleSource === "function"
                        ? getRuleSource(r)
                        : "manual";
                    return (
                      <div key={i} className="flex items-center gap-1 truncate text-foreground/80" title={r}>
                        <span className="px-1 py-px rounded text-[0.8em] bg-violet-500/10 text-violet-500 shrink-0">
                          {src}
                        </span>
                        <span className="truncate">• {r}</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
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
        <div
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 border-b text-[0.65em] shrink-0 animate-in fade-in slide-in-from-top-1",
            evolutionNote === "Самообучение выключено"
              ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
          )}
        >
          {evolutionNote === "Самообучение выключено" ? (
            <AlertCircleIcon className="w-3 h-3 shrink-0" />
          ) : (
            <CheckIcon className="w-3 h-3 shrink-0" />
          )}
          {evolutionNote}
          {evolutionNote !== "Самообучение выключено" && " — подход изменён для следующего ответа"}
        </div>
      )}

      {/* Behavior watch rule suggestions (R07) */}
      {behaviorSuggestions.map((s) => (
        <div
          key={s.id}
          data-testid={`behavior-suggestion-${s.id}`}
          className="flex items-center justify-between gap-2 px-2 py-1 border-b border-violet-500/30 bg-violet-500/10 text-[0.65em] text-violet-800 dark:text-violet-200 shrink-0 animate-in fade-in"
        >
          <span className="truncate">
            Предложить правило «{s.ruleText}?» ({s.reason})
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => handleConfirmSuggestion(s.id)}
              className="px-1.5 py-0.5 rounded bg-violet-600 text-white hover:bg-violet-700 font-medium"
            >
              Да
            </button>
            <button
              type="button"
              onClick={() => handleDismissSuggestion(s.id)}
              className="px-1.5 py-0.5 rounded border border-violet-500/40 hover:bg-violet-500/20 font-medium"
            >
              Нет
            </button>
          </div>
        </div>
      ))}

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
      {aiStatusMessage && (
        <div role="status" aria-live="polite" className="px-2 py-1 text-[0.75em] text-amber-700 dark:text-amber-300 shrink-0">
          {aiStatusMessage}
        </div>
      )}
      {isStalled && (
              /* Recovery shows only on a real stall: during healthy streaming
                 the same buttons re-fired processWithAI and killed the answer. */
              <div
                className="p-2 rounded-lg transition-all animate-in fade-in border border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200 shadow-sm"
              >
                <div className="mb-1.5 text-[0.8em] font-medium text-amber-700 dark:text-amber-300">
                  {`Провайдер молчит ${stalledSeconds}с — решайте: ${
                    stallNextId ? `ждать, повторить или взять ${stallNextId}` : "ждать или повторить"
                  }`}
                </div>
                <div className="flex items-center justify-between gap-2 text-[0.78em]">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={onStallWait}
                      className="px-2 py-0.5 rounded text-[0.95em] transition-colors cursor-pointer border border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 text-amber-950 dark:text-amber-100 font-medium"
                    >
                      Ждать
                    </button>
                    <button
                      type="button"
                      onClick={onStallRetry}
                      className="px-2 py-0.5 rounded text-[0.95em] transition-colors cursor-pointer border border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 text-amber-950 dark:text-amber-100 font-medium"
                    >
                      Повторить
                    </button>
                    <button
                      type="button"
                      onClick={onStallNext}
                      disabled={!stallNextId}
                      className="px-2 py-0.5 rounded text-[0.95em] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 text-amber-950 dark:text-amber-100 font-medium"
                    >
                      Другой{stallNextId ? ` (${stallNextId})` : ""}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenProviders) {
                        onOpenProviders();
                      } else {
                        void invoke("open_dashboard_page", { route: "/dev-space" }).catch(console.error);
                      }
                    }}
                    className="underline text-[0.9em] text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                  >
                    Провайдеры
                  </button>
                </div>
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
            <div className="space-y-1.5 my-1.5">
              <div className="p-3 rounded-lg border border-violet-500/30 bg-violet-500/5 text-violet-600 dark:text-violet-300 shadow-sm transition-all animate-in fade-in">
                <div className="flex items-center gap-1.5 mb-1 text-[0.72em] font-medium text-violet-500/90 tracking-wide uppercase">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Заполните паузу (зачитайте вслух):</span>
                </div>
                <div className="text-[0.95em] font-medium leading-snug tracking-normal select-text text-foreground/90 pl-1 border-l-2 border-violet-500/60">
                  «{activeFiller || fallbackFiller}»
                </div>
              </div>

            </div>
          ) : (
            <StreamingAiRow
              text={lastAIResponse}
              copied={copiedId === "live-ai-answer"}
              onCopy={() => handleCopy("live-ai-answer", answerForCopy(lastAIResponse))}
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
              <AICard
                key={rowId}
                id={rowId}
                text={e.text}
                streaming={e.streaming}
                feedback={feedbackGiven[rowId]}
                translation={translation}
                translationsOn={translationsOn}
                translationFailed={translationFailed(key)}
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
            <FeedRow
              key={rowId}
              id={rowId}
              kind={speechKind}
              text={e.text}
              streaming={e.streaming}
              translation={translation}
              translationsOn={translationsOn}
              translationFailed={translationFailed(key)}
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
              ruleTaken={Boolean(ruleTakenMap[rowId])}
              rulePreviewCandidate={
                rulePreview?.entryId === rowId ? rulePreview.candidate : null
              }
              onCopy={handleCopy}
              onAskAI={onAskAI}
              onTakeAsRule={handleTakeAsRule}
              onSaveRulePreview={handleSaveRulePreview}
              onEditRulePreview={handleEditRulePreview}
              onCancelRulePreview={handleCancelRulePreview}
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
        <button
          type="button"
          onClick={() => {
            // Clipboard, not file: one click, no dialogs, no paths to pick.
            // Context that matters for slowness: which models and settings
            // produced these numbers. Transcripts stay out of the dump.
            const dump = buildMetricsDump({
              appVersion,
              sttModel: handyModel || null,
              llmModel: llmModel || null,
              asrLanguage: getAsrLanguage(),
              speechModelLang: (() => { try { return getSpeechModelLang(); } catch { return null; } })(),
              answerLength: (() => { try { return getAnswerLengthOverride(); } catch { return null; } })(),
            });
            navigator.clipboard?.writeText(dump).catch(() => {});
            setDumpCopied(true);
            setTimeout(() => setDumpCopied(false), 1500);
          }}
          className="font-mono text-muted-foreground/70 hover:text-foreground"
          title="Дамп сессии в буфер: метрики + модели + настройки (без транскриптов)"
        >
          {dumpCopied ? "✓" : "⧉"}
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="font-mono text-violet-600/80 dark:text-violet-400/80 hover:underline hover:text-violet-600 dark:hover:text-violet-300 transition-colors flex items-center gap-1 cursor-pointer bg-transparent border-none p-0 text-[inherit]"
              title={`Активный провайдер: ${effectiveProviderId || "не выбран"}${llmModel ? ` · Модель: ${llmModel}` : ""}. Клик — переключить провайдер.`}
              data-testid="model-badge-dropdown-trigger"
            >
              <span>🤖</span>
              <span>
                {effectiveProviderId && llmModel
                  ? `${effectiveProviderId}/${llmModel}`
                  : effectiveProviderId || llmModel || "AI"}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-[0.7em] min-w-[160px]">
            {!allAiProviders || allAiProviders.length === 0 ? (
              <div className="px-2 py-1.5 text-muted-foreground text-xs">
                Нет доступных провайдеров
              </div>
            ) : (
              allAiProviders.map((p) => {
                const isSelected = p.id === effectiveProviderId;
                if (!p.id) return null;
                const providerId: string = p.id;
                const pModel = resolveProviderModel(p, {
                  provider: providerId,
                  variables: getAIProviderVariables(providerId),
                });
                return (
                  <DropdownMenuItem
                    key={providerId}
                    onClick={() => handleSelectProvider(providerId)}
                    className={cn(
                      "gap-1 cursor-pointer",
                      isSelected && "bg-primary/10 font-medium"
                    )}
                    data-testid={`provider-option-${p.id}`}
                  >
                    {isSelected && <CheckIcon className="w-3 h-3" />}
                    <span className="font-mono">{p.id}</span>
                    {pModel && (
                      <span className="text-muted-foreground ml-auto truncate max-w-[120px]">
                        ({pModel})
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
