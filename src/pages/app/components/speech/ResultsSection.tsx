import { useState, useEffect, useCallback, useRef } from "react";
import { ChatConversation, LiveSegment } from "@/hooks/useSystemAudio";
import { Markdown, Switch, CopyButton, Button } from "@/components";
import {
  BotIcon,
  HeadphonesIcon,
  Loader2,
  MicIcon,
  SparklesIcon,
  Languages,
  XIcon,
  RadioIcon,
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
  myLastTranscription,
  theirLastTranscription,
  lastAIResponse,
  isAIProcessing,
  conversation,
  conversationMode,
  setConversationMode,
  liveSegments,
  micSpeaking,
  micListening,
}: Props) => {
  const { selectedAIProvider, allAiProviders } = useApp();

  const [dualTranslate, setDualTranslate] = useState(false);
  const [translatedYou, setTranslatedYou] = useState("");
  const [translatedThem, setTranslatedThem] = useState("");
  const [translatedAI, setTranslatedAI] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<{
    id: string;
    content: string;
    source: string;
  } | null>(null);
  const [selectedTranslation, setSelectedTranslation] = useState("");

  const prevYouRef = useRef("");
  const prevThemRef = useRef("");
  const prevAIRef = useRef("");

  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modKey = isMac ? "⌘" : "Ctrl";

  // Explicit direction: Russian -> English, English -> Russian.
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
            ? "Translate the following text from Russian into English."
            : "Translate the following text from English into Russian.";
        let full = "";
        setter("");
        for await (const chunk of fetchAIResponse({
          provider: usePluely ? undefined : provider,
          selectedProvider: selectedAIProvider,
          systemPrompt:
            "You are a professional real-time translator. " +
            direction +
            " Output ONLY the raw translated text with zero commentary, no quotes, no labels.",
          history: [],
          userMessage: text,
        })) {
          full += chunk;
          setter(full);
        }
      } catch {
        // ignore translation errors
      } finally {
        setIsTranslating(false);
      }
    },
    [allAiProviders, selectedAIProvider]
  );

  useEffect(() => {
    if (!dualTranslate) return;

    if (myLastTranscription && myLastTranscription !== prevYouRef.current) {
      prevYouRef.current = myLastTranscription;
      translateStream(myLastTranscription, setTranslatedYou);
    }
    if (
      theirLastTranscription &&
      theirLastTranscription !== prevThemRef.current
    ) {
      prevThemRef.current = theirLastTranscription;
      translateStream(theirLastTranscription, setTranslatedThem);
    }
    if (lastAIResponse && lastAIResponse !== prevAIRef.current) {
      prevAIRef.current = lastAIResponse;
      translateStream(lastAIResponse, setTranslatedAI);
    }
  }, [
    dualTranslate,
    myLastTranscription,
    theirLastTranscription,
    lastAIResponse,
    translateStream,
  ]);

  // Click on a history message -> translate exactly that message.
  const handleMessageClick = useCallback(
    (message: { id: string; content: string; source: string }) => {
      setSelectedMessage(message);
      translateStream(message.content, setSelectedTranslation);
    },
    [translateStream]
  );

  // Unpin the selected translation.
  const handleUnpinTranslation = useCallback(() => {
    setSelectedMessage(null);
    setSelectedTranslation("");
  }, []);

  const hasTranscriptions = myLastTranscription || theirLastTranscription;
  const hasResponse = lastAIResponse || isAIProcessing;

  // Live feed: last few recognized segments (streaming recognition).
  const recentLiveSegments = liveSegments.slice(-4);

  const renderBubble = (
    text: string,
    source: "me" | "them",
    icon: typeof MicIcon,
    label: string,
    translatedText?: string
  ) => {
    if (!text) return null;
    const Icon = icon;
    return (
      <div
        className={cn(
          "flex items-start gap-1.5 p-1.5 rounded-lg border text-[0.85em] leading-relaxed animate-in fade-in duration-150",
          source === "me"
            ? "bg-primary/5 border-primary/20"
            : "bg-muted/40 border-border/40"
        )}
      >
        <div
          className={cn(
            "p-1 rounded-md mt-0.5 shrink-0",
            source === "me"
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="w-3 h-3" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className="text-[0.6em] font-semibold text-muted-foreground uppercase tracking-wider">
              {label}
            </span>
          </div>
          <p className="text-foreground/90 select-text break-words">{text}</p>
          {dualTranslate && translatedText && (
            <div className="mt-1.5 pt-1.5 border-t border-border/40 text-primary/90">
              <span className="text-[0.55em] font-medium text-primary/60 uppercase tracking-wider block mb-0.5">
                Translation (RU ↔ EN)
              </span>
              <p className="select-text break-words">{translatedText}</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const youBubble = renderBubble(
    myLastTranscription,
    "me",
    MicIcon,
    "You",
    translatedYou
  );
  const themBubble = renderBubble(
    theirLastTranscription,
    "them",
    HeadphonesIcon,
    "Them",
    translatedThem
  );

  return (
    <div
      className="space-y-3 pt-2"
      style={{ fontSize: "var(--app-font-size, 15px)" }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <div className="flex items-center gap-1.5">
          <SparklesIcon className="w-3.5 h-3.5 text-primary" />
          <h4 className="text-[0.8em] font-medium">
            {conversationMode ? "Conversation" : "AI Response"}
          </h4>
        </div>
        <div className="flex items-center gap-2 select-none">
          {/* Dual live translation button */}
          <Button
            size="sm"
            variant={dualTranslate ? "default" : "ghost"}
            className="h-6 px-2 text-[0.65em] gap-1"
            onClick={() => setDualTranslate((prev) => !prev)}
            title="Toggle live side-by-side translation (RU ↔ EN)"
          >
            <Languages className="w-3 h-3" />
            {dualTranslate ? "Dual RU ↔ EN" : "Translate"}
          </Button>

          <span className="text-[0.6em] text-muted-foreground/50 bg-muted/50 px-1 rounded">
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

      {/* Live recognition feed (streaming) */}
      {recentLiveSegments.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-muted/20 p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[0.6em] font-semibold text-muted-foreground uppercase tracking-wider">
              <RadioIcon className="w-3 h-3 text-primary animate-pulse" />
              Live recognition
            </span>
            {micSpeaking && (
              <span className="flex items-center gap-1 text-[0.6em] text-blue-600">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                You're speaking...
              </span>
            )}
            {micListening && !micSpeaking && (
              <span className="flex items-center gap-1 text-[0.6em] text-green-600">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Listening
              </span>
            )}
          </div>
          {recentLiveSegments.map((segment) => (
            <div
              key={segment.id}
              className={cn(
                "flex items-start gap-1.5 text-[0.8em] leading-relaxed",
                segment.source === "me" ? "text-blue-700" : "text-foreground/80"
              )}
            >
              <span className="text-[0.6em] font-semibold uppercase tracking-wider mt-0.5 shrink-0">
                {segment.source === "me" ? "You:" : "Them:"}
              </span>
              <span className="select-text break-words">{segment.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Main Content Area */}
      <div
        className={cn(
          "gap-3",
          dualTranslate && hasResponse
            ? "grid grid-cols-1 md:grid-cols-2"
            : "block"
        )}
      >
        {/* Left Column: Original Transcriptions & AI Response */}
        <div className="space-y-2">
          {!conversationMode && (
            <div className="space-y-2">
              {youBubble}
              {themBubble}

              {hasResponse && (
                <div>
                  {isAIProcessing && !lastAIResponse ? (
                    <div className="flex items-center gap-2 py-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-[0.8em] text-muted-foreground">
                        Generating response...
                      </span>
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <Markdown isStreaming={isAIProcessing}>
                        {lastAIResponse}
                      </Markdown>
                    </div>
                  )}
                </div>
              )}

              {/* Previous AI responses stay visible so text never disappears */}
              {conversation.messages.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-border/50">
                  <span className="text-[0.6em] font-semibold text-muted-foreground uppercase tracking-wider px-1">
                    Previous answers
                  </span>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {conversation.messages
                      .filter((m) => m.role === "assistant")
                      .slice(0, 4)
                      .map((message, i) => (
                        <div
                          key={i}
                          className="p-2 rounded-md border bg-background/50 text-[0.8em]"
                        >
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[0.6em] font-medium text-muted-foreground uppercase">
                              AI
                            </span>
                            <span className="text-[0.55em] text-muted-foreground/60">
                              {new Date(message.timestamp).toLocaleTimeString(
                                [],
                                { hour: "2-digit", minute: "2-digit" }
                              )}
                            </span>
                          </div>
                          <div className="text-muted-foreground leading-relaxed">
                            <Markdown>{message.content}</Markdown>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {conversationMode && (
            <div className="space-y-2">
              {hasResponse && (
                <div className="p-2 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-center gap-1.5 mb-1 text-primary">
                    <BotIcon className="w-3 h-3" />
                    <span className="text-[0.6em] font-semibold uppercase tracking-wider">
                      AI
                    </span>
                  </div>
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <Markdown isStreaming={isAIProcessing}>
                      {lastAIResponse}
                    </Markdown>
                  </div>
                </div>
              )}

              {hasTranscriptions && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[0.6em] font-semibold text-muted-foreground uppercase tracking-wider px-1">
                    Latest Input
                  </span>
                  {youBubble}
                  {themBubble}
                </div>
              )}

              {conversation.messages.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-border/50">
                  <span className="text-[0.6em] font-semibold text-muted-foreground uppercase tracking-wider px-1">
                    History ({conversation.messages.length}) — click a message
                    to translate it
                  </span>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {conversation.messages
                      .slice(0, 12)
                      .reverse()
                      .map((message, i) => (
                        <div
                          key={i}
                          onClick={() =>
                            handleMessageClick({
                              id: message.id || String(i),
                              content: message.content,
                              source: message.source || "unknown",
                            })
                          }
                          className={cn(
                            "text-[0.8em] p-2 rounded-md border cursor-pointer transition-colors hover:border-primary/40",
                            selectedMessage?.id === (message.id || String(i))
                              ? "bg-primary/10 border-primary/40"
                              : message.source === "me"
                                ? "bg-primary/5 border-primary/10"
                                : "bg-background/50"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[0.6em] font-medium text-muted-foreground uppercase">
                              {message.source === "me"
                                ? "You"
                                : message.source === "them"
                                  ? "Them"
                                  : "Message"}
                            </span>
                            <span className="text-[0.55em] text-muted-foreground/60">
                              {new Date(message.timestamp).toLocaleTimeString(
                                [],
                                { hour: "2-digit", minute: "2-digit" }
                              )}
                            </span>
                          </div>
                          <div className="text-muted-foreground leading-relaxed mt-0.5">
                            <Markdown>{message.content}</Markdown>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Mirror Live Translation (when Dual Mode is ON) */}
        {dualTranslate && (
          <div className="space-y-2 rounded-lg border border-primary/20 bg-muted/10 p-2.5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
              <div className="flex items-center gap-1.5 text-primary text-[0.8em] font-medium">
                <Languages className="w-3.5 h-3.5" />
                <span>Live Translation (RU ↔ EN)</span>
              </div>
              {isTranslating && (
                <span className="flex items-center gap-1 text-[0.65em] text-muted-foreground">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  Translating...
                </span>
              )}
            </div>

            {/* Selected history message translation (unpinnable) */}
            {selectedMessage && (
              <div className="rounded-md border border-primary/20 bg-background/60 p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[0.55em] font-medium text-primary/70 uppercase tracking-wider">
                    Selected message
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5"
                    title="Unpin translation"
                    onClick={handleUnpinTranslation}
                  >
                    <XIcon className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-[0.7em] text-muted-foreground mb-1.5 line-clamp-2">
                  {selectedMessage.content}
                </p>
                <div className="prose prose-sm max-w-none dark:prose-invert text-[0.8em] leading-relaxed">
                  {selectedTranslation ? (
                    <Markdown isStreaming={isTranslating}>
                      {selectedTranslation}
                    </Markdown>
                  ) : (
                    <span className="text-[0.8em] text-muted-foreground italic">
                      Translating...
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Live AI response translation */}
            <div className="prose prose-sm max-w-none dark:prose-invert text-[0.8em] leading-relaxed">
              {translatedAI ? (
                <Markdown isStreaming={isTranslating}>{translatedAI}</Markdown>
              ) : (
                <span className="text-[0.8em] text-muted-foreground italic">
                  Live translation will stream here as the response generates...
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
