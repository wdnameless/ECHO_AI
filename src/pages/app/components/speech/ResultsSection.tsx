import { ChatConversation, LiveSegment } from "@/hooks/useSystemAudio";
import { cn } from "@/lib/utils";
import { useHandyStatus } from "@/hooks/useHandyStatus";
import { SubtitleFeed } from "./SubtitleFeed";

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
  onDeepen?: () => void;
  feedPaused?: boolean;
  onTogglePause?: () => void;
  lastTTFT?: number;
  pipelineError?: string;
  pendingQuestion?: string | null;
  askAIForTranscript?: (
    utteranceId: string,
    text: string,
    source: "me" | "them"
  ) => Promise<void>;
  activeFiller?: string | null;
  pendingUtteranceId?: string | null;
};

/**
 * Variant-3 subtitle surface: everything (my speech / their speech / AI
 * answers) renders as a compact two-column feed inside the app window —
 * original on the left, translation on the right. No popup answer card.
 */
export const ResultsSection = ({
  myLastTranscription,
  theirLastTranscription,
  lastAIResponse,
  isAIProcessing,
  conversation,
  liveSegments,
  micSpeaking,
  onDeepen,
  feedPaused,
  onTogglePause,
  lastTTFT,
  pipelineError,
  pendingQuestion,
  askAIForTranscript,
  activeFiller,
  pendingUtteranceId,
}: Props) => {
  const handy = useHandyStatus();
  const handyModelShort = handy.model
    ? handy.model.split("/").pop()?.replace(".gguf", "") || handy.model
    : "";

  void myLastTranscription;

  return (
    <div
      className={cn(
        "flex flex-col h-full min-h-0 w-full min-w-0 overflow-hidden"
      )}
    >
      <SubtitleFeed
        conversation={conversation}
        liveSegments={liveSegments}
        lastAIResponse={lastAIResponse}
        isAIProcessing={isAIProcessing}
        theirLastTranscription={theirLastTranscription}
        micSpeaking={micSpeaking}
        handyOnline={handy.online}
        handyModel={handyModelShort}
        wsReconnects={handy.metrics.wsReconnectCount}
        lostSegments={handy.metrics.lostSegmentsCount}
        lastSttDurationMs={handy.metrics.lastSttDurationMs ?? undefined}
        onDeepen={onDeepen}
        feedPaused={feedPaused ?? false}
        onTogglePause={onTogglePause ?? (() => {})}
        lastTTFT={lastTTFT ?? handy.metrics.lastTtftMs ?? undefined}
        pipelineError={pipelineError}
        pendingQuestion={pendingQuestion}
        onAskAI={askAIForTranscript}
        activeFiller={activeFiller}
        pendingUtteranceId={pendingUtteranceId}
      />
    </div>
  );
};
