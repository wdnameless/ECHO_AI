import { useState, useEffect, useCallback, useRef } from "react";
import { ChatConversation, LiveSegment } from "@/hooks/useSystemAudio";
import { Markdown, Switch, CopyButton, Button } from "@/components";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HeadphonesIcon,
  Loader2,
  Languages,
  XIcon,
  HistoryIcon,
  GraduationCapIcon,
  MessageCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  SparklesIcon,
  ZapIcon,
  RotateCcwIcon,
  RadioIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  CheckCircle2Icon,
  PauseIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/contexts";
import { fastTranslate } from "@/lib/fast-translator";
import { recordFeedback } from "@/lib/storage/user-facts";
import { useHandyStatus } from "@/hooks/useHandyStatus";
import { formatSpokenAnswer } from "@/lib/spoken-format";

type Props = {
  myLastTranscription: string;
  theirLastTranscription: string;
  lastAIResponse: string;
  isAIProcessing: boolean;
  conversation: ChatConversation;
  conversationMode: boolean;
  setConversationMode: (mode: boolean) => void;
  liveSegments: LiveSegment[];
  micSpeaking: boolean;
  micListening: boolean;
  scrollAreaRef?: React.RefObject<HTMLDivElement | null>;
};

export const ResultsSection = ({
  myLastTranscription,
  theirLastTranscription,
  lastAIResponse,
  isAIProcessing,
  conversation,
  conversationMode,
  setConversationMode,
  liveSegments,
  micSpeaking,
  micListening: _micListening,
  scrollAreaRef,
}: Props) => {
  const {
    promptProfiles,
    activeProfileId,
    selectPromptProfile,
    selectedAIProvider,
  } = useApp();

  const [dualTranslate, setDualTranslate] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Active answer displayed to the user while speaking
  const [displayedAnswer, setDisplayedAnswer] = useState<string>("");
  // Buffered new answer generated while user was still reading current answer
  const [pendingNewAnswer, setPendingNewAnswer] = useState<string>("");
  // Previous answer history for easy revert
  const [previousAnswer, setPreviousAnswer] = useState<string>("");

  // Countdown timer for automatic switch to new answer
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isHeld, setIsHeld] = useState<boolean>(false);

  // Subtitles / Translations
  const [interviewerTranslation, setInterviewerTranslation] = useState("");
  const [isTranslatingInterviewer, setIsTranslatingInterviewer] = useState(false);
  const [translatedAI, setTranslatedAI] = useState("");
  const [isTranslatingAI, setIsTranslatingAI] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<{
    id: string;
    content: string;
    source: string;
  } | null>(null);
  const [selectedTranslation, setSelectedTranslation] = useState("");
  const [isTranslatingSelected, setIsTranslatingSelected] = useState(false);

  // Feedback state
  const [feedbackGiven, setFeedbackGiven] = useState<"like" | "dislike" | null>(null);
  const [showDislikeMenu, setShowDislikeMenu] = useState(false);

  const prevTheirRef = useRef("");
  const prevAIRef = useRef("");
  const tickerRef = useRef<HTMLDivElement>(null);
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modKey = isMac ? "⌘" : "Ctrl";

  const activeProfile =
    promptProfiles.find((p) => p.id === activeProfileId) || promptProfiles[0];

  // Local Handy STT server health (green indicator + model name)
  const handy = useHandyStatus(5000);
  const handyModelShort = handy.model
    ? handy.model.split("/").pop()?.replace(".gguf", "") || handy.model
    : "";

  const handleGiveFeedback = useCallback(
    (rating: "like" | "dislike", reason?: string) => {
      const ans = displayedAnswer || lastAIResponse;
      if (!ans) return;
      recordFeedback(theirLastTranscription || "General conversation", ans, rating, reason);
      setFeedbackGiven(rating);
      setShowDislikeMenu(false);
    },
    [displayedAnswer, lastAIResponse, theirLastTranscription]
  );

  // Track when the user is actively speaking so we know a new answer
  // arrived WHILE they were mid-answer (needs buffering), vs. them
  // listening quietly to a new question (show instantly).
  const wasSpeakingRef = useRef(false);
  const lastUserSpeechAtRef = useRef<number>(0);
  useEffect(() => {
    if (micSpeaking && !wasSpeakingRef.current) {
      lastUserSpeechAtRef.current = Date.now();
    }
    wasSpeakingRef.current = micSpeaking;
  }, [micSpeaking]);

  // Robust fallback: any mic transcription (even if VAD missed the speech
  // flag) means the user was talking - remember it so a new AI answer that
  // arrives right after is buffered, not force-switched.
  const prevMyTranscriptionRef = useRef("");
  useEffect(() => {
    if (myLastTranscription && myLastTranscription !== prevMyTranscriptionRef.current) {
      prevMyTranscriptionRef.current = myLastTranscription;
      lastUserSpeechAtRef.current = Date.now();
    }
  }, [myLastTranscription]);

  // Answer buffer logic:
  // - New stream is a continuation of the current answer -> update in place.
  // - A NEW response began while the user was speaking (or just stopped
  //   within the last 4 seconds) -> the interviewer interrupted them:
  //   BUFFER the new answer, show "Next answer" button + countdown.
  // - User is quiet / listening -> show new answer INSTANTLY (0ms).
  useEffect(() => {
    if (!lastAIResponse) return;

    const isContinuation =
      displayedAnswer &&
      lastAIResponse.startsWith(displayedAnswer.slice(0, 20)) &&
      lastAIResponse.length > displayedAnswer.length;

    if (isContinuation) {
      setDisplayedAnswer(lastAIResponse);
      return;
    }

    const userSpokeRecently =
      Date.now() - lastUserSpeechAtRef.current < 6000;

    // HARD RULE: while the user is actively speaking, a new AI answer is
    // ALWAYS buffered - never force-switch the screen mid-answer.
    if (micSpeaking) {
      setPendingNewAnswer(lastAIResponse);
      if (countdown === null) {
        setCountdown(10);
      }
      setIsHeld(false);
      return;
    }

    if (!displayedAnswer) {
      // Very first answer of the conversation: show directly.
      setDisplayedAnswer(lastAIResponse);
      setPendingNewAnswer("");
      setCountdown(null);
      setIsHeld(false);
      return;
    }

    if (userSpokeRecently) {
      // The interviewer interrupted or re-asked while we were talking.
      // Keep the current answer on screen, buffer the new one.
      setPendingNewAnswer(lastAIResponse);
      if (countdown === null) {
        setCountdown(10);
      }
      setIsHeld(false);
    } else {
      // User is quiet and listening: show the new answer instantly.
      setDisplayedAnswer(lastAIResponse);
      setPendingNewAnswer("");
      setCountdown(null);
      setIsHeld(false);
    }
  }, [lastAIResponse, displayedAnswer, countdown, micSpeaking]);

  // Countdown timer effect (auto-apply new answer when timer expires)
  useEffect(() => {
    if (countdown === null || isHeld) return;

    if (countdown <= 0) {
      if (pendingNewAnswer) {
        setPreviousAnswer(displayedAnswer);
        setDisplayedAnswer(pendingNewAnswer);
        setPendingNewAnswer("");
      }
      setCountdown(null);
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, isHeld, pendingNewAnswer, displayedAnswer]);

  // Apply buffered new answer immediately (user clicks "Next answer")
  const handleApplyPendingAnswer = useCallback(() => {
    if (pendingNewAnswer) {
      setPreviousAnswer(displayedAnswer);
      setDisplayedAnswer(pendingNewAnswer);
      setPendingNewAnswer("");
      setCountdown(null);
      setIsHeld(false);
    }
  }, [pendingNewAnswer, displayedAnswer]);

  // "Оставить текущий" = FULL FREEZE: current answer stays forever,
  // timer stops completely; only "Next answer" button can switch it.
  const handleFreezeCurrentAnswer = useCallback(() => {
    setIsHeld(true);
    setCountdown(null);
  }, []);

  // "+10с" = extend the auto-switch countdown by 10 more seconds
  const handleExtendCountdown = useCallback(() => {
    setIsHeld(false);
    setCountdown((prev) => (prev ?? 0) + 10);
  }, []);

  const handleRevertToPreviousAnswer = useCallback(() => {
    if (previousAnswer) {
      const current = displayedAnswer;
      setDisplayedAnswer(previousAnswer);
      setPreviousAnswer(current);
    }
  }, [previousAnswer, displayedAnswer]);

  // Smooth auto-scroll for main answer area
  useEffect(() => {
    if (!scrollAreaRef?.current || !lastAIResponse) return;
    const viewport = scrollAreaRef.current.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    if (viewport) {
      const isNearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 140;
      if (isNearBottom) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      }
    }
  }, [lastAIResponse, displayedAnswer, scrollAreaRef]);

  // Smooth auto-scroll for live transcript ticker at the top
  useEffect(() => {
    if (tickerRef.current) {
      tickerRef.current.scrollTo({
        top: tickerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [liveSegments, myLastTranscription, theirLastTranscription]);

  // Clear states on new conversation
  useEffect(() => {
    if (conversation.messages.length === 0) {
      setDisplayedAnswer("");
      setPendingNewAnswer("");
      setPreviousAnswer("");
      setInterviewerTranslation("");
      setCountdown(null);
      setIsHeld(false);
    }
  }, [conversation.messages.length]);

  // Instant machine translation of Interviewer speech (< 100ms via Google Translate).
  // Direction is ALWAYS the opposite of the source language: RU speech -> EN
  // translation, EN speech -> RU translation. Never translate into the same
  // language the speaker is using.
  useEffect(() => {
    if (!theirLastTranscription || theirLastTranscription === prevTheirRef.current) return;
    prevTheirRef.current = theirLastTranscription;

    let cancelled = false;
    setIsTranslatingInterviewer(true);
    fastTranslate(theirLastTranscription)
      .then((translated) => {
        if (!cancelled) setInterviewerTranslation(translated);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsTranslatingInterviewer(false);
      });

    return () => {
      cancelled = true;
    };
  }, [theirLastTranscription]);

  // Instant translation of AI response when side-by-side translation is enabled
  useEffect(() => {
    const answerToTranslate = displayedAnswer || lastAIResponse;
    if (!dualTranslate || !answerToTranslate || answerToTranslate === prevAIRef.current) return;
    prevAIRef.current = answerToTranslate;

    let cancelled = false;
    setIsTranslatingAI(true);
    fastTranslate(answerToTranslate)
      .then((translated) => {
        if (!cancelled) setTranslatedAI(translated);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsTranslatingAI(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dualTranslate, displayedAnswer, lastAIResponse]);

  // Click on a message in history to translate instantly
  const handleMessageClick = useCallback(async (message: { id: string; content: string; source: string }) => {
    setSelectedMessage(message);
    setIsTranslatingSelected(true);
    try {
      const trans = await fastTranslate(message.content);
      setSelectedTranslation(trans);
    } catch {
      setSelectedTranslation(message.content);
    } finally {
      setIsTranslatingSelected(false);
    }
  }, []);

  const hasResponse = !!displayedAnswer || !!lastAIResponse || isAIProcessing;

  return (
    <div
      className="space-y-2 pt-0.5 w-full min-w-0 max-w-full overflow-x-hidden relative"
      style={{ fontSize: "var(--app-font-size, 15px)" }}
    >
      {/* Sleek Minimal Top Control Bar */}
      <div className="flex items-center justify-between border-b border-border/40 pb-1.5 px-0.5 select-none gap-1.5 w-full min-w-0 max-w-full">
        {/* Left: Active Profile Switcher Dropdown */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[0.7em] gap-1 font-semibold border-primary/30 bg-primary/5 hover:bg-primary/10 text-foreground shrink-0"
                title="Switch prompt profile"
              >
                {activeProfile?.id === "profile-interview" ? (
                  <GraduationCapIcon className="w-3 h-3 text-primary shrink-0" />
                ) : (
                  <MessageCircleIcon className="w-3 h-3 text-primary shrink-0" />
                )}
                <span className="truncate max-w-[110px]">{activeProfile?.name || "Profile"}</span>
                <ChevronDownIcon className="w-2.5 h-2.5 opacity-60 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 text-xs">
              <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Select Profile
              </div>
              {promptProfiles.map((profile) => {
                const isSelected = profile.id === activeProfileId;
                const Icon =
                  profile.id === "profile-interview"
                    ? GraduationCapIcon
                    : MessageCircleIcon;
                return (
                  <DropdownMenuItem
                    key={profile.id}
                    onClick={() => selectPromptProfile(profile.id)}
                    className={cn(
                      "flex items-center justify-between cursor-pointer gap-2 py-1.5",
                      isSelected && "font-medium text-primary bg-primary/10"
                    )}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{profile.name}</span>
                    </div>
                    {isSelected && <CheckIcon className="w-3.5 h-3.5 text-primary shrink-0" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Real-time speech status indicator */}
          <div className="flex items-center gap-1 text-[0.7em] text-muted-foreground truncate min-w-0">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                isAIProcessing
                  ? "bg-amber-500 animate-ping"
                  : micSpeaking
                  ? "bg-blue-500 animate-pulse"
                  : "bg-emerald-500"
              )}
            />
            <span className="truncate text-foreground/80 font-medium">
              {isAIProcessing
                ? "AI generating..."
                : micSpeaking
                ? "You're speaking..."
                : "Live stream"}
            </span>
          </div>

          {/* Handy Local STT availability indicator */}
          <span
            className={cn(
              "flex items-center gap-1 text-[0.65em] font-medium px-1.5 py-0.5 rounded-full border shrink-0",
              handy.online
                ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                : "text-red-500 bg-red-500/10 border-red-500/30"
            )}
            title={
              handy.online
                ? `Handy local STT is ONLINE (${handy.model || "model"})`
                : "Handy local STT is OFFLINE - using the selected provider as fallback"
            }
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                handy.online ? "bg-emerald-500 animate-pulse" : "bg-red-500"
              )}
            />
            {handy.online
              ? handyModelShort || "Handy STT"
              : "STT offline → fallback"}
          </span>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Active Model Indicator Pill */}
          <span
            className="text-[0.65em] font-mono font-medium text-muted-foreground/80 bg-muted/30 border border-border/40 px-1.5 py-0.5 rounded truncate max-w-[100px]"
            title={`Active LLM: ${selectedAIProvider?.provider || "AI"} | STT: GPU Local`}
          >
            ⚡ {selectedAIProvider?.provider || "AI"}
          </span>

          {/* Dual Translation Toggle */}
          <Button
            size="sm"
            variant={dualTranslate ? "default" : "ghost"}
            className="h-6 px-2 text-[0.7em] gap-1"
            onClick={() => setDualTranslate((prev) => !prev)}
            title="Toggle side-by-side translation (RU ↔ EN)"
          >
            <Languages className="w-3 h-3" />
            <span>{dualTranslate ? "RU ↔ EN" : "Translate"}</span>
          </Button>

          {/* History Toggle */}
          {conversation.messages.length > 0 && (
            <Button
              size="sm"
              variant={showHistory ? "secondary" : "ghost"}
              className="h-6 px-2 text-[0.7em] gap-1"
              onClick={() => setShowHistory((h) => !h)}
              title="Toggle chat history"
            >
              <HistoryIcon className="w-3 h-3" />
              <span>{conversation.messages.length}</span>
            </Button>
          )}

          <span className="text-[0.6em] text-muted-foreground/40 bg-muted/40 px-1 py-0.5 rounded font-mono">
            {modKey}+K
          </span>
          <Switch
            checked={conversationMode}
            onCheckedChange={setConversationMode}
            className="scale-75"
          />
          {(displayedAnswer || lastAIResponse) && (
            <CopyButton content={displayedAnswer || lastAIResponse} />
          )}
        </div>
      </div>

      {/* CONTINUOUS LIVE TRANSCRIPT STREAM TICKER (RESIZABLE & AUTO-SCROLL) */}
      <div className="rounded-lg border border-border/40 bg-muted/20 p-1.5 space-y-1 w-full min-w-0 max-w-full select-none resize-y overflow-auto min-h-[44px] max-h-[220px]">
        <div className="flex items-center justify-between text-[0.65em] font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
          <span className="flex items-center gap-1">
            <RadioIcon className="w-2.5 h-2.5 text-primary animate-pulse" />
            Live Speech Stream
          </span>
          <span className="text-[0.85em] font-mono lowercase opacity-70">resizable ↕</span>
        </div>
        <div
          ref={tickerRef}
          className="space-y-0.5 max-h-32 overflow-y-auto pr-0.5 font-sans text-[0.78em] leading-tight w-full min-w-0 break-words no-scrollbar"
        >
          {liveSegments.slice(-4).map((seg) => (
            <div
              key={seg.id}
              className={cn(
                "flex items-start gap-1 w-full min-w-0 break-words py-0.5 px-1 rounded transition-all",
                seg.source === "me"
                  ? "bg-blue-500/10 text-blue-800 dark:text-blue-300"
                  : "bg-primary/5 text-foreground",
                seg.partial && "animate-pulse"
              )}
            >
              <span className="font-semibold text-[0.85em] uppercase shrink-0 mt-0.5">
                {seg.source === "me" ? "🎤 You:" : "🎧 Them:"}
              </span>
              {seg.source === "them" && handy.online && (
                <span
                  className="shrink-0 mt-0.5 text-[0.6em] font-mono font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1 py-px rounded-full"
                  title={`Распознано локальной моделью: ${handy.model || "Nemotron 3.5 ASR (GPU)"}`}
                >
                  Nemotron GPU
                </span>
              )}
              <span className="flex-1 min-w-0 break-words select-text">
                {seg.text}
                {seg.partial && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary/70 align-middle animate-pulse" />
                )}
              </span>
            </div>
          ))}
          {liveSegments.length === 0 && (
            <div className="text-muted-foreground/60 italic text-[0.72em] py-0.5 px-1">
              Audio stream active. Transcripts from mic and system appear here in real-time...
            </div>
          )}
        </div>
      </div>

      {/* Live System Audio / Interviewer Question & Instant Subtitle Bar (RESIZABLE) */}
      {theirLastTranscription && (
        <div className="p-2 rounded-xl border border-primary/20 bg-primary/5 space-y-0.5 w-full min-w-0 max-w-full resize-y overflow-auto min-h-[44px] max-h-[220px] animate-in fade-in duration-150">
          <div className="flex items-center justify-between text-[0.68em]">
            <span className="font-semibold text-primary flex items-center gap-1 uppercase tracking-wider">
              <HeadphonesIcon className="w-3 h-3" />
              Interviewer Question (↕)
            </span>
            {handy.online && (
              <span
                className="text-[0.6em] font-mono font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-px rounded-full"
                title={`Распознано локальной моделью: ${handy.model || "Nemotron 3.5 ASR (GPU)"}`}
              >
                🎧 Nemotron GPU
              </span>
            )}
            {isTranslatingInterviewer && (
              <span className="text-muted-foreground flex items-center gap-1 text-[0.6em]">
                <Loader2 className="w-2 h-2 animate-spin" />
                translating...
              </span>
            )}
          </div>
          {/* Original speech - wrapped safely */}
          <p className="text-[0.85em] text-foreground/90 font-medium select-text leading-snug break-words w-full min-w-0"
            style={{ wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
          >
            {theirLastTranscription}
          </p>
          {/* Instant Russian translation subtitle */}
          {interviewerTranslation && interviewerTranslation !== theirLastTranscription && (
            <div className="pt-0.5 border-t border-primary/10 text-primary/90 text-[0.8em] leading-snug select-text flex items-start gap-1 break-words w-full min-w-0"
              style={{ wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
            >
              <span className="text-[0.62em] font-semibold text-primary/60 uppercase shrink-0 mt-0.5">
                RU:
              </span>
              <span className="flex-1 min-w-0 break-words">{interviewerTranslation}</span>
            </div>
          )}
        </div>
      )}

      {/* COUNTDOWN TIMER & SMART SWITCH BANNER (only when user was interrupted mid-answer) */}
      {pendingNewAnswer && (
        <div className="p-2 rounded-xl border border-amber-500/40 bg-amber-500/10 shadow-sm flex items-center justify-between gap-2 animate-in slide-in-from-top-1 duration-200 select-none">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <ZapIcon className="w-4 h-4 text-amber-500 shrink-0 animate-bounce" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[0.75em] font-semibold text-amber-900 dark:text-amber-300">
                  ⚡ Новый ответ от интервьюера
                </span>
                {countdown !== null && (
                  <span className="text-[0.7em] font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded-full">
                    автопоказ: {countdown}с
                  </span>
                )}
              </div>
              <p className="text-[0.68em] text-amber-800/80 dark:text-amber-400/80 truncate">
                {pendingNewAnswer.slice(0, 50)}...
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 flex-wrap">
            {/* Freeze current answer - "Оставить текущий" = полная заморозка */}
            <Button
              size="sm"
              variant="outline"
              onClick={handleFreezeCurrentAnswer}
              className="h-6 px-2 text-[0.68em] border-amber-500/40 text-amber-900 dark:text-amber-300 hover:bg-amber-500/20 gap-1"
              title="Полностью заморозить текущий ответ (таймер остановлен, пока не нажмёте «Следующий ответ»)"
            >
              <XIcon className="w-2.5 h-2.5" />
              <span>Оставить текущий</span>
            </Button>
            {/* Extend countdown by +10s */}
            <Button
              size="sm"
              variant="outline"
              onClick={handleExtendCountdown}
              className="h-7 px-2 text-[0.68em] border-amber-500/40 text-amber-900 dark:text-amber-300 hover:bg-amber-500/20 gap-1"
              title="Продлить таймер ещё на 10 секунд"
            >
              <PauseIcon className="w-2.5 h-2.5" />
              <span>+10с</span>
            </Button>
            {/* Show Next Answer Button */}
            <Button
              size="sm"
              onClick={handleApplyPendingAnswer}
              className="h-7 px-2.5 text-[0.7em] font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow gap-1"
              title="Показать следующий ответ на переформулированный вопрос"
            >
              <ZapIcon className="w-3 h-3" />
              <span>Следующий ответ</span>
            </Button>
          </div>
        </div>
      )}

      {/* Main Focus Area: Generated AI Answer (RESIZABLE & Rock-solid text wrapping) */}
      <div
        className={cn(
          "gap-2 w-full min-w-0 max-w-full overflow-hidden",
          dualTranslate && hasResponse ? "grid grid-cols-1 md:grid-cols-2" : "block"
        )}
      >
        {/* Left / Main: The Current Active AI Answer */}
        <div className="space-y-1 w-full min-w-0 max-w-full overflow-hidden">
          {isAIProcessing && !displayedAnswer && !lastAIResponse ? (
            <div className="flex items-center gap-2 py-4 px-2 text-primary animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-[0.85em] font-medium">Thinking aloud...</span>
            </div>
          ) : displayedAnswer || lastAIResponse ? (
            <div className="p-3 rounded-xl border border-border/60 bg-background shadow-sm space-y-1 w-full min-w-0 max-w-full resize-y overflow-auto min-h-[80px] max-h-[450px]">
              <div className="flex items-center justify-between text-[0.65em] text-muted-foreground select-none">
                <span className="font-semibold text-primary uppercase tracking-wider flex items-center gap-1">
                  <SparklesIcon className="w-3 h-3" />
                  Your Active Answer (↕)
                </span>
                <div className="flex items-center gap-1">
                  {/* Feedback 👍 / 👎 for Self-Evolution learning */}
                  {feedbackGiven ? (
                    <span className="flex items-center gap-1 text-[0.9em] text-emerald-600 dark:text-emerald-400 font-medium px-1">
                      <CheckCircle2Icon className="w-3 h-3" />
                      {feedbackGiven === "like" ? "Паттерн усвоен 👍" : "Учтено 👎"}
                    </span>
                  ) : (
                    <div className="flex items-center gap-0.5 relative">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10"
                        title="Лайк: сохранить стиль и закрепить паттерн"
                        onClick={() => handleGiveFeedback("like")}
                      >
                        <ThumbsUpIcon className="w-3 h-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                        title="Дизлайк: указать замечание к стилю"
                        onClick={() => setShowDislikeMenu((prev) => !prev)}
                      >
                        <ThumbsDownIcon className="w-3 h-3" />
                      </Button>

                      {/* Dislike reasons popover menu */}
                      {showDislikeMenu && (
                        <div className="absolute right-0 top-6 z-50 w-48 rounded-lg border border-border/80 bg-background/95 p-1 shadow-lg text-[10px] space-y-0.5 animate-in fade-in duration-100">
                          <div className="px-2 py-1 font-semibold text-muted-foreground border-b border-border/40 uppercase tracking-wider text-[8px]">
                            Что улучшить?
                          </div>
                          {[
                            "Слишком длинно / много воды",
                            "Слишком сухо / роботизировано",
                            "Слишком сложно / академично",
                            "Не попал в тему вопроса",
                            "Лишние вводные слова",
                          ].map((reason) => (
                            <button
                              key={reason}
                              onClick={() => handleGiveFeedback("dislike", reason)}
                              className="w-full text-left px-2 py-1 rounded hover:bg-muted text-foreground/90 transition-colors"
                            >
                              {reason}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {previousAnswer && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleRevertToPreviousAnswer}
                      className="h-5 text-[0.9em] gap-1 px-1.5 text-muted-foreground hover:text-foreground"
                      title="Switch back to previous answer"
                    >
                      <RotateCcwIcon className="w-2.5 h-2.5" />
                      Назад
                    </Button>
                  )}
                </div>
              </div>
              {/* Guaranteed unbroken text wrapping + smart spoken paragraphs */}
              <div
                className="text-[0.92em] leading-relaxed text-foreground select-text w-full min-w-0 max-w-full break-words space-y-2"
                style={{
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                  hyphens: "auto",
                  maxWidth: "100%",
                }}
              >
                {formatSpokenAnswer(displayedAnswer || lastAIResponse).map(
                  (paragraph, idx) => (
                    <p
                      key={idx}
                      className={cn(
                        "leading-relaxed",
                        idx > 0 &&
                          "mt-2 pt-2 border-t border-border/40 border-dashed"
                      )}
                    >
                      {paragraph}
                    </p>
                  )
                )}
              </div>
            </div>
          ) : (
            !theirLastTranscription && (
              <div className="py-5 text-center text-muted-foreground/60 text-[0.8em]">
                Ready. Sound from system and mic is recognized continuously above.
              </div>
            )
          )}
        </div>

        {/* Right: Instant Google Translation Panel (When RU ↔ EN Toggle is ON) */}
        {dualTranslate && hasResponse && (
          <div className="p-2.5 rounded-xl border border-border/50 bg-muted/10 space-y-1.5 w-full min-w-0 max-w-full resize-y overflow-auto min-h-[70px] max-h-[380px]">
            <div className="flex items-center justify-between border-b border-border/30 pb-1">
              <span className="text-[0.72em] font-semibold text-primary flex items-center gap-1">
                <Languages className="w-3 h-3" />
                Instant Translation (Google API)
              </span>
              {isTranslatingAI && (
                <span className="text-[0.62em] text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-2 h-2 animate-spin" />
                  translating...
                </span>
              )}
            </div>

            {selectedMessage ? (
              <div className="space-y-1 bg-background/80 p-2 rounded-lg border border-primary/20 w-full min-w-0 max-w-full">
                <div className="flex items-center justify-between">
                  <span className="text-[0.65em] font-medium text-primary">Selected turn</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-4 w-4"
                    onClick={() => setSelectedMessage(null)}
                  >
                    <XIcon className="w-3 h-3" />
                  </Button>
                </div>
                <div
                  className="text-[0.85em] leading-relaxed text-foreground select-text w-full min-w-0 break-words"
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    overflowWrap: "anywhere",
                  }}
                >
                  {isTranslatingSelected ? "Translating..." : selectedTranslation}
                </div>
              </div>
            ) : (
              <div
                className="text-[0.88em] leading-relaxed text-foreground/90 select-text w-full min-w-0 max-w-full break-words"
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                }}
              >
                {translatedAI || (
                  <span className="text-[0.75em] text-muted-foreground italic">
                    Instant translation will appear here...
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Slide-out Overlay History Drawer (does not push content, floats above) */}
      {showHistory && conversation.messages.length > 0 && (
        <div className="absolute inset-0 z-30 rounded-xl border border-primary/20 bg-background/95 backdrop-blur-sm shadow-2xl p-2.5 overflow-y-auto animate-in slide-in-from-right-1/4 duration-200 flex flex-col min-w-0">
          <div className="flex items-center justify-between pb-2 border-b border-border/40 shrink-0">
            <span className="text-[0.7em] font-semibold text-muted-foreground uppercase tracking-wider">
              Conversation History ({conversation.messages.length})
            </span>
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setShowHistory(false)}>
              <XIcon className="w-3 h-3" />
            </Button>
          </div>
          <div className="space-y-1.5 pt-2 w-full min-w-0 flex-1 overflow-y-auto">
            {conversation.messages.slice(0, 15).reverse().map((msg, i) => (
              <div
                key={i}
                onClick={() =>
                  handleMessageClick({
                    id: msg.id || String(i),
                    content: msg.content,
                    source: msg.source || "unknown",
                  })
                }
                className={cn(
                  "p-2 rounded-lg border text-[0.8em] cursor-pointer transition-colors hover:border-primary/40 w-full min-w-0 max-w-full break-words",
                  msg.role === "assistant"
                    ? "bg-primary/5 border-primary/20"
                    : "bg-muted/30 border-border/30"
                )}
              >
                <div className="flex items-center justify-between mb-0.5 text-[0.65em] text-muted-foreground">
                  <span className="font-semibold uppercase">
                    {msg.role === "assistant"
                      ? "AI Cue"
                      : msg.source === "me"
                      ? "You"
                      : "Interviewer"}
                  </span>
                  <span>
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div
                  className="text-foreground/90 leading-relaxed select-text w-full min-w-0 break-words"
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    overflowWrap: "anywhere",
                  }}
                >
                  <Markdown>{msg.content}</Markdown>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
