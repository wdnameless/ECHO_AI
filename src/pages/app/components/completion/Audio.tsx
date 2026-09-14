import { useEffect } from "react";
import { InfoIcon } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components";
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
  const autoVadVisible =
    (pluelyApiEnabled || speechProviderStatus) && enableVAD && !suppressAutoVAD;

  return (
    <Popover open={micOpen} onOpenChange={setMicOpen}>
      {/* Кнопка-микрофон убрана: она дублировала переключатель «Диктовка»,
          а сам голосовой ввод для AI остаётся доступен по хоткею
          (Ctrl+Shift+J). Якорь сохраняет позицию popover'а с подсказкой
          о ненастроенном провайдере. */}
      <PopoverAnchor className="w-0 h-0" />

      {autoVadVisible && (
        <AutoSpeechVAD
          key={selectedAudioDevices.input.id}
          submit={submit}
          setState={setState}
          setEnableVAD={setEnableVAD}
          microphoneDeviceId={selectedAudioDevices.input.id}
        />
      )}

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
