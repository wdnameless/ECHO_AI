import { ChatConversation } from "@/hooks/useSystemAudio";
import { Markdown, Switch, CopyButton } from "@/components";
import {
  BotIcon,
  HeadphonesIcon,
  Loader2,
  MicIcon,
  SparklesIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  myLastTranscription: string;
  theirLastTranscription: string;
  lastAIResponse: string;
  isAIProcessing: boolean;
  conversation: ChatConversation;
  conversationMode: boolean;
  setConversationMode: (mode: boolean) => void;
};

export const ResultsSection = ({
  myLastTranscription,
  theirLastTranscription,
  lastAIResponse,
  isAIProcessing,
  conversation,
  conversationMode,
  setConversationMode,
}: Props) => {
  const hasResponse = lastAIResponse || isAIProcessing;
  const hasHistory = conversation.messages.length > 2;

  if (!hasResponse && !myLastTranscription && !theirLastTranscription) {
    return null;
  }

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const modKey = isMac ? "⌘" : "Ctrl";

  const youBubble = myLastTranscription && (
    <div className="rounded-md border-l-2 border-blue-400/60 bg-blue-500/5 p-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <MicIcon className="h-3 w-3 text-blue-500" />
        <span className="text-[9px] font-medium text-blue-500 uppercase tracking-wide">
          You
        </span>
      </div>
      <p className="text-[11px] leading-relaxed">{myLastTranscription}</p>
    </div>
  );

  const themBubble = theirLastTranscription && (
    <div className="rounded-md border-l-2 border-primary/50 bg-primary/5 p-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <HeadphonesIcon className="h-3 w-3 text-primary" />
        <span className="text-[9px] font-medium text-primary uppercase tracking-wide">
          Them
        </span>
      </div>
      <p className="text-[11px] leading-relaxed">{theirLastTranscription}</p>
    </div>
  );

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <SparklesIcon className="w-3.5 h-3.5 text-primary" />
          <h4 className="text-xs font-medium">
            {conversationMode ? "Conversation" : "AI Response"}
          </h4>
        </div>
        <div className="flex items-center gap-2 select-none">
          <span className="text-[9px] text-muted-foreground/50 bg-muted/50 px-1 rounded">
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

      {/* RESPONSE MODE: transcriptions, then AI response */}
      {!conversationMode && (
        <div className="space-y-2">
          {/* Live transcription tracks */}
          {youBubble}
          {themBubble}

          {/* AI Response */}
          {hasResponse && (
            <div>
              {isAIProcessing && !lastAIResponse ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">
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
        </div>
      )}

      {/* CONVERSATION MODE: AI on top, then You/Them, then history */}
      {conversationMode && (
        <div className="space-y-2">
          {/* AI Response - First (on top) */}
          {hasResponse && (
            <div className="rounded-md bg-background/50 p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <BotIcon className="h-3 w-3 text-muted-foreground" />
                <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
                  AI
                </span>
              </div>
              {isAIProcessing && !lastAIResponse ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">
                    Generating...
                  </span>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none dark:prose-invert text-sm">
                  <Markdown isStreaming={isAIProcessing}>
                    {lastAIResponse}
                  </Markdown>
                </div>
              )}
            </div>
          )}

          {/* Live transcription tracks - Second */}
          {youBubble}
          {themBubble}

          {/* Previous Messages */}
          {hasHistory && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">
                Previous
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {conversation.messages
                  .slice(2)
                  .sort((a, b) => b.timestamp - a.timestamp)
                  .map((message, index) => (
                    <div
                      key={message.id || index}
                      className={cn(
                        "p-2 rounded-md text-[11px]",
                        message.role === "user"
                          ? message.source === "me"
                            ? "bg-blue-500/5 border-l-2 border-blue-400/40"
                            : "bg-primary/5 border-l-2 border-primary/30"
                          : "bg-background/50"
                      )}
                    >
                      <span className="text-[8px] font-medium text-muted-foreground uppercase">
                        {message.source === "me"
                          ? "You"
                          : message.source === "them"
                            ? "Them"
                            : "AI"}
                      </span>
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
  );
};
