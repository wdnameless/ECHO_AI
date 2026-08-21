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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/contexts";
import { fastTranslate } from "@/lib/fast-translator";

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
};

export const ResultsSection = ({
  myLastTranscription: _myLastTranscription,
  theirLastTranscription,
  lastAIResponse,
  isAIProcessing,
  conversation,
  conversationMode,
  setConversationMode,
  liveSegments,
  micSpeaking,
  micListening: _micListening,
}: Props) => {
  const { promptProfiles, activeProfileId, selectPromptProfile } = useApp();

  const [dualTranslate, setDualTranslate] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
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

  const prevTheirRef = useRef("");
  const prevAIRef = useRef("");
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modKey = isMac ? "⌘" : "Ctrl";

  const activeProfile =
    promptProfiles.find((p) => p.id === activeProfileId) || promptProfiles[0];

  // Instant machine translation of Interviewer speech (< 100ms via Google Translate)
  useEffect(() => {
    if (!theirLastTranscription || theirLastTranscription === prevTheirRef.current) return;
    prevTheirRef.current = theirLastTranscription;

    let cancelled = false;
    setIsTranslatingInterviewer(true);
    fastTranslate(theirLastTranscription, "ru")
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
    if (!dualTranslate || !lastAIResponse || lastAIResponse === prevAIRef.current) return;
    prevAIRef.current = lastAIResponse;

    let cancelled = false;
    setIsTranslatingAI(true);
    fastTranslate(lastAIResponse)
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
  }, [dualTranslate, lastAIResponse]);

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

  const lastLiveText = liveSegments.length > 0 ? liveSegments[liveSegments.length - 1] : null;
  const hasResponse = !!lastAIResponse || isAIProcessing;

  return (
    <div
      className="space-y-2 pt-0.5"
      style={{ fontSize: "var(--app-font-size, 15px)" }}
    >
      {/* Sleek Minimal Top Control Bar */}
      <div className="flex items-center justify-between border-b border-border/40 pb-1.5 px-0.5 select-none gap-1.5">
        {/* Left: Active Profile Switcher Dropdown */}
        <div className="flex items-center gap-1.5 min-w-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[0.7em] gap-1 font-semibold border-primary/30 bg-primary/5 hover:bg-primary/10 text-foreground"
                title="Switch prompt profile (Interview / General / Custom)"
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

          {/* Real-time speech status */}
          <div className="flex items-center gap-1 text-[0.7em] text-muted-foreground truncate">
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
            <span className="truncate">
              {isAIProcessing
                ? "AI generating..."
                : micSpeaking
                ? "You're speaking..."
                : lastLiveText
                ? `${lastLiveText.source === "me" ? "You: " : "Them: "}${lastLiveText.text}`
                : "Listening"}
            </span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 shrink-0">
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
          {lastAIResponse && <CopyButton content={lastAIResponse} />}
        </div>
      </div>

      {/* Live System Audio / Interviewer Speech & Instant Subtitle Bar */}
      {theirLastTranscription && (
        <div className="p-2.5 rounded-xl border border-primary/20 bg-primary/5 space-y-1 animate-in fade-in duration-150">
          <div className="flex items-center justify-between text-[0.7em]">
            <span className="font-semibold text-primary flex items-center gap-1 uppercase tracking-wider">
              <HeadphonesIcon className="w-3 h-3" />
              Interviewer Speech
            </span>
            {isTranslatingInterviewer && (
              <span className="text-muted-foreground flex items-center gap-1 text-[0.65em]">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                translating...
              </span>
            )}
          </div>
          {/* Original speech */}
          <p className="text-[0.85em] text-foreground/90 font-medium select-text leading-snug">
            {theirLastTranscription}
          </p>
          {/* Instant Russian translation subtitle */}
          {interviewerTranslation && interviewerTranslation !== theirLastTranscription && (
            <div className="pt-1 border-t border-primary/10 text-primary/90 text-[0.8em] leading-snug select-text flex items-start gap-1">
              <span className="text-[0.65em] font-semibold text-primary/60 uppercase shrink-0 mt-0.5">
                RU:
              </span>
              <span>{interviewerTranslation}</span>
            </div>
          )}
        </div>
      )}

      {/* Main Focus Area: Generated AI Answer */}
      <div
        className={cn(
          "gap-2.5",
          dualTranslate && hasResponse ? "grid grid-cols-1 md:grid-cols-2" : "block"
        )}
      >
        {/* Left / Main: The Generated AI Answer */}
        <div className="space-y-1.5">
          {isAIProcessing && !lastAIResponse ? (
            <div className="flex items-center gap-2 py-4 px-2 text-primary animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-[0.85em] font-medium">Thinking aloud...</span>
            </div>
          ) : lastAIResponse ? (
            <div className="p-3 rounded-xl border border-border/60 bg-background shadow-sm space-y-1">
              <div className="flex items-center justify-between text-[0.65em] text-muted-foreground">
                <span className="font-semibold text-primary uppercase tracking-wider flex items-center gap-1">
                  <SparklesIcon className="w-3 h-3" />
                  Your AI Cue
                </span>
              </div>
              <div
                className="text-[0.92em] leading-relaxed text-foreground select-text"
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                  maxWidth: "100%",
                }}
              >
                {lastAIResponse}
              </div>
            </div>
          ) : (
            !theirLastTranscription && (
              <div className="py-6 text-center text-muted-foreground/60 text-[0.8em]">
                Ready for conversation. System audio & mic will appear here live.
              </div>
            )
          )}
        </div>

        {/* Right: Instant Google Translation Panel (When RU ↔ EN Toggle is ON) */}
        {dualTranslate && hasResponse && (
          <div className="p-3 rounded-xl border border-border/50 bg-muted/10 space-y-2">
            <div className="flex items-center justify-between border-b border-border/30 pb-1">
              <span className="text-[0.75em] font-semibold text-primary flex items-center gap-1">
                <Languages className="w-3 h-3" />
                Instant Translation (Google API)
              </span>
              {isTranslatingAI && (
                <span className="text-[0.65em] text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  translating...
                </span>
              )}
            </div>

            {selectedMessage ? (
              <div className="space-y-1 bg-background/80 p-2 rounded-lg border border-primary/20">
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
                <div className="text-[0.85em] leading-relaxed text-foreground select-text">
                  {isTranslatingSelected ? "Translating..." : selectedTranslation}
                </div>
              </div>
            ) : (
              <div
                className="text-[0.88em] leading-relaxed text-foreground/90 select-text"
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

      {/* Collapsible Clean History Drawer */}
      {showHistory && conversation.messages.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-border/40 space-y-1.5 animate-in fade-in duration-200">
          <div className="flex items-center justify-between px-1">
            <span className="text-[0.7em] font-semibold text-muted-foreground uppercase tracking-wider">
              Conversation History ({conversation.messages.length})
            </span>
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setShowHistory(false)}>
              <XIcon className="w-3 h-3" />
            </Button>
          </div>
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
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
                  "p-2 rounded-lg border text-[0.8em] cursor-pointer transition-colors hover:border-primary/40",
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
                <div className="text-foreground/90 leading-relaxed select-text">
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
