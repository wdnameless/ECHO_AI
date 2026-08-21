import { useState, useEffect, useCallback, useRef } from "react";
import { ChatConversation, LiveSegment } from "@/hooks/useSystemAudio";
import { Markdown, Switch, CopyButton, Button } from "@/components";
import {
  HeadphonesIcon,
  Loader2,
  Languages,
  XIcon,
  HistoryIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/contexts";
import { fetchAIResponse, shouldUsePluelyAPI } from "@/lib";
import { detectLanguage } from "@/lib/language-detect";

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
  const { selectedAIProvider, allAiProviders } = useApp();

  const [dualTranslate, setDualTranslate] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [translatedAI, setTranslatedAI] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<{
    id: string;
    content: string;
    source: string;
  } | null>(null);
  const [selectedTranslation, setSelectedTranslation] = useState("");

  const prevAIRef = useRef("");
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modKey = isMac ? "⌘" : "Ctrl";

  // Stream translation cleanly
  const translateStream = useCallback(
    async (text: string, setter: (val: string) => void) => {
      if (!text.trim()) {
        setter("");
        return;
      }
      setIsTranslating(true);
      try {
        const usePluely = await shouldUsePluelyAPI();
        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        const detected = detectLanguage(text);
        const direction =
          detected === "russian"
            ? "Translate from Russian into natural, conversational English."
            : "Translate from English into natural, conversational Russian.";
        let full = "";
        setter("");
        for await (const chunk of fetchAIResponse({
          provider: usePluely ? undefined : provider,
          selectedProvider: selectedAIProvider,
          systemPrompt:
            "You are a real-time translator. " +
            direction +
            " Output ONLY raw translated text without commentary, quotes or prefixes.",
          history: [],
          userMessage: text,
        })) {
          full += chunk;
          setter(full);
        }
      } catch {
        // ignore
      } finally {
        setIsTranslating(false);
      }
    },
    [allAiProviders, selectedAIProvider]
  );

  // Auto-translate AI response when dual translation is active
  useEffect(() => {
    if (!dualTranslate) return;
    if (lastAIResponse && lastAIResponse !== prevAIRef.current) {
      prevAIRef.current = lastAIResponse;
      translateStream(lastAIResponse, setTranslatedAI);
    }
  }, [dualTranslate, lastAIResponse, translateStream]);

  // Click on a message in history to translate
  const handleMessageClick = useCallback(
    (message: { id: string; content: string; source: string }) => {
      setSelectedMessage(message);
      translateStream(message.content, setSelectedTranslation);
    },
    [translateStream]
  );

  const lastLiveText = liveSegments.length > 0 ? liveSegments[liveSegments.length - 1] : null;
  const hasResponse = !!lastAIResponse || isAIProcessing;

  return (
    <div
      className="space-y-2.5 pt-1"
      style={{ fontSize: "var(--app-font-size, 15px)" }}
    >
      {/* Sleek Minimal Header */}
      <div className="flex items-center justify-between border-b border-border/40 pb-1.5 px-0.5 select-none">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "w-2 h-2 rounded-full",
              isAIProcessing ? "bg-amber-500 animate-ping" : micSpeaking ? "bg-blue-500 animate-pulse" : "bg-emerald-500"
            )} />
            <span className="text-[0.75em] font-medium text-muted-foreground">
              {isAIProcessing ? "AI Thinking..." : micSpeaking ? "You're speaking..." : "Ready"}
            </span>
          </div>

          {/* Active live speech hint */}
          {lastLiveText && (
            <span className="text-[0.7em] text-muted-foreground/70 truncate max-w-[220px]">
              {lastLiveText.source === "me" ? "You: " : "Them: "}
              {lastLiveText.text}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
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

      {/* Main Focus Area: Crisp, Distraction-Free AI Answer */}
      <div
        className={cn(
          "gap-3",
          dualTranslate && hasResponse ? "grid grid-cols-1 md:grid-cols-2" : "block"
        )}
      >
        {/* Left / Main: The Generated AI Answer */}
        <div className="space-y-2">
          {isAIProcessing && !lastAIResponse ? (
            <div className="flex items-center gap-2 py-4 px-2 text-primary animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-[0.85em] font-medium">Formulating natural answer...</span>
            </div>
          ) : lastAIResponse ? (
            <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 shadow-sm">
              <div className="prose prose-sm max-w-none dark:prose-invert text-[0.92em] leading-relaxed text-foreground select-text">
                <Markdown isStreaming={isAIProcessing}>
                  {lastAIResponse}
                </Markdown>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-muted-foreground/60 text-[0.8em]">
              Waiting for question... Ask anything or let the interview start.
            </div>
          )}

          {/* Context Question (Compact) */}
          {theirLastTranscription && (
            <div className="flex items-start gap-1.5 px-2 py-1 text-[0.75em] text-muted-foreground/80 bg-muted/20 rounded-md">
              <HeadphonesIcon className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                <strong className="font-semibold text-muted-foreground">Q: </strong>
                {theirLastTranscription}
              </span>
            </div>
          )}
        </div>

        {/* Right: Clean Translation Panel (Only when Translation is ON) */}
        {dualTranslate && hasResponse && (
          <div className="p-3 rounded-xl border border-border/50 bg-muted/10 space-y-2">
            <div className="flex items-center justify-between border-b border-border/30 pb-1">
              <span className="text-[0.75em] font-semibold text-primary flex items-center gap-1">
                <Languages className="w-3 h-3" />
                Live Translation (RU ↔ EN)
              </span>
              {isTranslating && (
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
                  <Button size="icon" variant="ghost" className="h-4 w-4" onClick={() => setSelectedMessage(null)}>
                    <XIcon className="w-3 h-3" />
                  </Button>
                </div>
                <div className="text-[0.85em] leading-relaxed text-foreground select-text">
                  <Markdown isStreaming={isTranslating}>{selectedTranslation}</Markdown>
                </div>
              </div>
            ) : (
              <div className="text-[0.85em] leading-relaxed text-foreground/90 select-text">
                {translatedAI ? (
                  <Markdown isStreaming={isTranslating}>{translatedAI}</Markdown>
                ) : (
                  <span className="text-[0.75em] text-muted-foreground italic">
                    Translation will stream here...
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collapsible Clean History Drawer */}
      {showHistory && conversation.messages.length > 0 && (
        <div className="mt-3 pt-2 border-t border-border/40 space-y-1.5 animate-in fade-in duration-200">
          <div className="flex items-center justify-between px-1">
            <span className="text-[0.7em] font-semibold text-muted-foreground uppercase tracking-wider">
              Conversation History ({conversation.messages.length})
            </span>
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setShowHistory(false)}>
              <XIcon className="w-3 h-3" />
            </Button>
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {conversation.messages.slice(0, 15).reverse().map((msg, i) => (
              <div
                key={i}
                onClick={() => handleMessageClick({ id: msg.id || String(i), content: msg.content, source: msg.source || "unknown" })}
                className={cn(
                  "p-2 rounded-lg border text-[0.8em] cursor-pointer transition-colors hover:border-primary/40",
                  msg.role === "assistant" ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-border/30"
                )}
              >
                <div className="flex items-center justify-between mb-0.5 text-[0.65em] text-muted-foreground">
                  <span className="font-semibold uppercase">{msg.role === "assistant" ? "AI Cue" : msg.source === "me" ? "You" : "Interviewer"}</span>
                  <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
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
