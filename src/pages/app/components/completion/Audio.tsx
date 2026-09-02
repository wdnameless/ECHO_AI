import { useEffect } from "react";
import { InfoIcon, MicIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, Button } from "@/components";
import { cn } from "@/lib/utils";
import { AutoSpeechVAD } from "./AutoSpeechVad";
import { UseCompletionReturn } from "@/types";
import { useApp } from "@/contexts";
import { useMicState, micStateStore } from "@/stores/mic-state";

export const Audio = ({
  micOpen,
  setMicOpen,
  enableVAD,
  setEnableVAD,
  submit,
  setState,
  suppressAutoVAD,
}: UseCompletionReturn & { suppressAutoVAD?: boolean }) => {
  const micState = useMicState();
  const isAssistantActive = micState.mode === "ASSISTANT";

  // Keep enableVAD in sync with micStateStore ASSISTANT mode
  useEffect(() => {
    if (enableVAD && micState.mode !== "ASSISTANT") {
      micStateStore.setMode("ASSISTANT");
    } else if (!enableVAD && micState.mode === "ASSISTANT") {
      micStateStore.setMode("IDLE");
    }
  }, [enableVAD, micState.mode]);

  // When store transitions to non-ASSISTANT, ensure enableVAD is false
  useEffect(() => {
    if (micState.mode !== "ASSISTANT" && enableVAD) {
      setEnableVAD(false);
    }
  }, [micState.mode, enableVAD, setEnableVAD]);
  const { selectedSttProvider, pluelyApiEnabled, selectedAudioDevices } =
    useApp();

  const speechProviderStatus = selectedSttProvider.provider;

  return (
    <Popover open={micOpen} onOpenChange={setMicOpen}>
      <PopoverTrigger asChild>
        {(pluelyApiEnabled || speechProviderStatus) &&
        enableVAD &&
        !suppressAutoVAD ? (
          <AutoSpeechVAD
            key={selectedAudioDevices.input.id}
            submit={submit}
            setState={setState}
            setEnableVAD={setEnableVAD}
            microphoneDeviceId={selectedAudioDevices.input.id}
          />
        ) : (
          <Button
            size="icon"
            onClick={() => {
              if (isAssistantActive) {
                micStateStore.setMode("IDLE");
                setEnableVAD(false);
              } else {
                micStateStore.setMode("ASSISTANT");
                setEnableVAD(true);
              }
            }}
            className={cn(
              "cursor-pointer transition-colors",
              isAssistantActive && "bg-purple-600 hover:bg-purple-700 text-white shadow-sm",
              suppressAutoVAD && "hidden"
            )}
            title={isAssistantActive ? "Stop Voice for AI" : "Voice for AI (Ask AI)"}
          >
            <MicIcon className={cn("h-4 w-4", isAssistantActive && "text-white animate-pulse")} />
          </Button>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        className={`w-80 p-3 ${
          pluelyApiEnabled || speechProviderStatus ? "hidden" : ""
        }`}
        sideOffset={8}
      >
        <div className="text-sm select-none">
          <div className="font-semibold text-orange-600 mb-1">
            Speech Provider Configuration Required
          </div>
          <p className="text-muted-foreground">
            {!speechProviderStatus ? (
              <>
                <div className="mt-2 flex flex-row gap-1 items-center text-orange-600">
                  <InfoIcon size={16} />
                  {selectedSttProvider.provider ? null : (
                    <p>PROVIDER IS MISSING</p>
                  )}
                </div>

                <span className="block mt-2">
                  Please go to settings and configure your speech provider to
                  enable voice input.
                </span>
              </>
            ) : null}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
};
