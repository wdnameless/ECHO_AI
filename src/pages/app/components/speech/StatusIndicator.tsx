import { AlertCircleIcon, HeadphonesIcon, LoaderIcon, MicIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  setupRequired: boolean;
  error: string;
  isProcessing: boolean;
  isAIProcessing: boolean;
  capturing: boolean;
  micActive: boolean;
  systemActive: boolean;
  micSpeaking: boolean;
};

export const StatusIndicator = ({
  setupRequired,
  error,
  isProcessing,
  isAIProcessing,
  capturing,
  micActive,
  systemActive,
  micSpeaking,
}: Props) => {
  // Don't show anything if not capturing and no error
  if (!capturing && !error && !isProcessing && !isAIProcessing) {
    return null;
  }

  return (
    <div className="flex flex-1 items-center gap-2 px-3 py-2 justify-end">
      {/* Priority: Error > AI Processing > Transcribing > Listening */}
      {error && !setupRequired ? (
        <div
          className="flex items-center gap-1.5 text-red-500 max-w-[280px] min-w-0"
          title={error}
        >
          <AlertCircleIcon className="w-4 h-4 shrink-0" />
          <span className="text-xs font-medium truncate">{error}</span>
        </div>
      ) : isAIProcessing ? (
        <div className="flex items-center gap-2 animate-pulse">
          <LoaderIcon className="w-4 h-4 animate-spin" />
          <span className="text-xs font-medium">Generating response...</span>
        </div>
      ) : isProcessing ? (
        <div className="flex items-center gap-2 animate-pulse">
          <LoaderIcon className="w-4 h-4 animate-spin" />
          <span className="text-xs font-medium">Transcribing...</span>
        </div>
      ) : capturing ? (
        <div className="flex items-center gap-3">
          {systemActive && (
            <div className="flex items-center gap-1.5 text-green-600">
              <HeadphonesIcon className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium">System</span>
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            </div>
          )}
          {micActive && (
            <div
              className={cn(
                "flex items-center gap-1.5",
                micSpeaking ? "text-blue-600" : "text-green-600"
              )}
            >
              <MicIcon
                className={cn("w-3.5 h-3.5", micSpeaking && "animate-pulse")}
              />
              <span className="text-[10px] font-medium">
                {micSpeaking ? "You're speaking..." : "Mic"}
              </span>
              <div
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  micSpeaking
                    ? "bg-blue-500 animate-pulse"
                    : "bg-green-500 animate-pulse"
                )}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
