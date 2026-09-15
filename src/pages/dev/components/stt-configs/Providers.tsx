import { Button, Header, Input, Selection, TextInput } from "@/components";
import { UseSettingsReturn } from "@/types";
import curl2Json, { ResultJSON } from "@bany/curl-to-json";
import { TrashIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSecret, saveSecret, removeSecret, secretKey } from "@/lib/storage/secret-store";

export const Providers = ({
  allSttProviders,
  selectedSttProvider,
  onSetSelectedSttProvider,
  sttVariables,
}: UseSettingsReturn) => {
  const [localSelectedProvider, setLocalSelectedProvider] =
    useState<ResultJSON | null>(null);

  const sttProviderId = selectedSttProvider?.provider || "";
  const apiKeyVar = sttVariables?.find((v) => v?.key === "api_key");

  /** Ключ живёт в защищённом хранилище, а не в настройках провайдера. */
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!sttProviderId || !apiKeyVar) {
        setApiKey("");
        return;
      }
      const stored = await getSecret(secretKey.sttProvider(sttProviderId));
      if (!cancelled) setApiKey(stored ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [sttProviderId, apiKeyVar]);

  const persistApiKey = useCallback(
    async (value: string) => {
      if (!sttProviderId) return;
      setApiKey(value);
      const trimmed = value.trim();
      if (trimmed) {
        await saveSecret(secretKey.sttProvider(sttProviderId), trimmed);
      } else {
        await removeSecret(secretKey.sttProvider(sttProviderId));
      }
    },
    [sttProviderId]
  );

  useEffect(() => {
    if (selectedSttProvider?.provider) {
      const provider = allSttProviders?.find(
        (p) => p?.id === selectedSttProvider?.provider
      );
      if (provider) {
        const json = curl2Json(provider?.curl);
        setLocalSelectedProvider(json as ResultJSON);
      }
    }
  }, [selectedSttProvider?.provider]);

  const findKeyAndValue = (key: string) => {
    return sttVariables?.find((v) => v?.key === key);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Header
          title="Select STT Provider"
          description="Select your preferred STT service provider or custom providers to get started."
        />
        <Selection
          selected={selectedSttProvider?.provider}
          options={allSttProviders?.map((provider) => {
            const json = curl2Json(provider?.curl);
            return {
              label:
                (provider as any)?.name ||
                provider?.isCustom
                  ? json?.url || provider?.id || "Custom Provider"
                  : provider?.id || "Custom Provider",
              value: provider?.id || "Custom Provider",
              isCustom: provider?.isCustom,
            };
          })}
          placeholder="Choose your STT provider"
          onChange={(value) => {
            onSetSelectedSttProvider({
              provider: value,
              variables: {},
            });
          }}
        />
      </div>
      {localSelectedProvider ? (
        <Header
          title={`Method: ${
            localSelectedProvider?.method || "Invalid"
          }, Endpoint: ${localSelectedProvider?.url || "Invalid"}`}
          description={`If you want to use different url or method, you can always create a custom provider.`}
        />
      ) : null}
      {findKeyAndValue("api_key") ? (
        <div className="space-y-2">
          <Header
            title="API Key"
            description={`Enter your ${
              allSttProviders?.find(
                (p) => p?.id === selectedSttProvider?.provider
              )?.isCustom
                ? "Custom Provider"
                : selectedSttProvider?.provider
            } API key to authenticate and access STT models. Your key is stored locally and never shared.`}
          />

          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="**********"
                value={apiKey}
                onChange={(value) => {
                  void persistApiKey(
                    typeof value === "string" ? value : value.target.value
                  );
                }}
                disabled={false}
                className="flex-1 h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
              />
              {apiKey.trim() ? (
                <Button
                  onClick={() => {
                    void persistApiKey("");
                  }}
                  size="icon"
                  variant="destructive"
                  className="shrink-0 h-11 w-11"
                  title="Remove API Key"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Ключ хранится в защищённом хранилище ОС, а не в localStorage.
            </p>
          </div>
        </div>
      ) : null}

      <div className="space-y-4 mt-2">
        {sttVariables
          ?.filter(
            (variable) => variable?.key !== findKeyAndValue("api_key")?.key
          )
          .map((variable) => {
            const getVariableValue = () => {
              if (!variable?.key || !selectedSttProvider?.variables) return "";
              return selectedSttProvider.variables[variable.key] || "";
            };

            return (
              <div className="space-y-1" key={variable?.key}>
                <Header
                  title={variable?.value || ""}
                  description={`add your preferred ${variable?.key?.replace(
                    /_/g,
                    " "
                  )} for ${
                    allSttProviders?.find(
                      (p) => p?.id === selectedSttProvider?.provider
                    )?.isCustom
                      ? "Custom Provider"
                      : selectedSttProvider?.provider
                  }`}
                />
                <TextInput
                  placeholder={`Enter ${
                    allSttProviders?.find(
                      (p) => p?.id === selectedSttProvider?.provider
                    )?.isCustom
                      ? "Custom Provider"
                      : selectedSttProvider?.provider
                  } ${variable?.key?.replace(/_/g, " ") || "value"}`}
                  value={getVariableValue()}
                  onChange={(value) => {
                    if (!variable?.key || !selectedSttProvider) return;

                    onSetSelectedSttProvider({
                      ...selectedSttProvider,
                      variables: {
                        ...selectedSttProvider.variables,
                        [variable.key]: value,
                      },
                    });
                  }}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
};
