import { Button, Header, Input, Selection, TextInput } from "@/components";
import { UseSettingsReturn } from "@/types";
import curl2Json, { ResultJSON } from "@bany/curl-to-json";
import { KeyIcon, TrashIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  buildDynamicMessages,
  deepVariableReplacer,
} from "@/lib/functions/common.function";

export const Providers = ({
  allAiProviders,
  selectedAIProvider,
  onSetSelectedAIProvider,
  variables,
}: UseSettingsReturn) => {
  const [localSelectedProvider, setLocalSelectedProvider] =
    useState<ResultJSON | null>(null);
  const [testState, setTestState] = useState<
    | { status: "idle" | "testing" }
    | { status: "ok" | "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    if (selectedAIProvider?.provider) {
      const provider = allAiProviders?.find(
        (p) => p?.id === selectedAIProvider?.provider
      );
      if (provider) {
        const json = curl2Json(provider?.curl);
        setLocalSelectedProvider(json as ResultJSON);
      }
    }
  }, [selectedAIProvider?.provider]);

  const findKeyAndValue = (key: string) => {
    return variables?.find((v) => v?.key === key);
  };

  const getApiKeyValue = () => {
    const apiKeyVar = findKeyAndValue("api_key");
    if (!apiKeyVar || !selectedAIProvider?.variables) return "";
    return selectedAIProvider?.variables?.[apiKeyVar.key] || "";
  };

  const isApiKeyEmpty = () => {
    return !getApiKeyValue().trim();
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Header
          title="Select AI Provider"
          description="Select your preferred AI service provider or custom providers to get started."
        />
        <Selection
          selected={selectedAIProvider?.provider}
          options={allAiProviders?.map((provider) => {
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
          placeholder="Choose your AI provider"
          onChange={(value) => {
            onSetSelectedAIProvider({
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
              allAiProviders?.find(
                (p) => p?.id === selectedAIProvider?.provider
              )?.isCustom
                ? "Custom Provider"
                : selectedAIProvider?.provider
            } API key to authenticate and access AI models. Your key is stored locally and never shared.`}
          />

          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="**********"
                value={getApiKeyValue()}
                onChange={(value) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selectedAIProvider) return;

                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [apiKeyVar.key]:
                        typeof value === "string" ? value : value.target.value,
                    },
                  });
                }}
                onKeyDown={(e) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selectedAIProvider) return;

                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [apiKeyVar.key]: (e.target as HTMLInputElement).value,
                    },
                  });
                }}
                disabled={false}
                className="flex-1 h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
              />
              {isApiKeyEmpty() ? (
                <Button
                  onClick={() => {
                    const apiKeyVar = findKeyAndValue("api_key");
                    if (!apiKeyVar || !selectedAIProvider || isApiKeyEmpty())
                      return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [apiKeyVar.key]: getApiKeyValue(),
                      },
                    });
                  }}
                  disabled={isApiKeyEmpty()}
                  size="icon"
                  className="shrink-0 h-11 w-11"
                  title="Submit API Key"
                >
                  <KeyIcon className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    const apiKeyVar = findKeyAndValue("api_key");
                    if (!apiKeyVar || !selectedAIProvider) return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [apiKeyVar.key]: "",
                      },
                    });
                  }}
                  size="icon"
                  variant="destructive"
                  className="shrink-0 h-11 w-11"
                  title="Remove API Key"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-4 mt-2">
        {variables
          .filter(
            (variable) => variable.key !== findKeyAndValue("api_key")?.key
          )
          .map((variable) => {
            const getVariableValue = () => {
              if (!variable?.key || !selectedAIProvider?.variables) return "";
              return selectedAIProvider.variables[variable.key] || "";
            };

            return (
              <div className="space-y-1" key={variable?.key}>
                <Header
                  title={variable?.value || ""}
                  description={`add your preferred ${variable?.key?.replace(
                    /_/g,
                    " "
                  )} for ${
                    allAiProviders?.find(
                      (p) => p?.id === selectedAIProvider?.provider
                    )?.isCustom
                      ? "Custom Provider"
                      : selectedAIProvider?.provider
                  }`}
                />
                <TextInput
                  placeholder={`Enter ${
                    allAiProviders?.find(
                      (p) => p?.id === selectedAIProvider?.provider
                    )?.isCustom
                      ? "Custom Provider"
                      : selectedAIProvider?.provider
                  } ${variable?.key?.replace(/_/g, " ") || "value"}`}
                  value={getVariableValue()}
                  onChange={(value) => {
                    if (!variable?.key || !selectedAIProvider) return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [variable.key]: value,
                      },
                    });
                  }}
                />
              </div>
            );
          })}
      </div>

      {/* Test the selected provider with a real request */}
      <div className="pt-2 border-t border-border/40">
        <Button
          onClick={async () => {
            setTestState({ status: "testing" });
            try {
              const provider = allAiProviders?.find(
                (p) => p?.id === selectedAIProvider?.provider
              );
              if (!provider) throw new Error("Provider not selected");

              const json = curl2Json(provider.curl);
              const url = json?.url;
              if (!url) throw new Error("Invalid provider URL");

              // Resolve variables from the selected provider config.
              const vars: Record<string, string> = {
                ...(selectedAIProvider?.variables ?? {}),
                TEXT: "Привет! Это тестовый запрос. Ответь одним коротким предложением.",
                SYSTEM_PROMPT: "Ты — ассистент. Отвечай кратко.",
              };
              const modelVar = Object.keys(vars).find(
                (k) => k.toLowerCase() === "model"
              );
              if (modelVar) vars[modelVar] = vars[modelVar] || "test";

              // Build the body exactly like the real pipeline: dynamic
              // messages ({{TEXT}}/{{IMAGE}} handled properly — empty image
              // parts are REMOVED, not left as empty strings) + variable
              // replacement for the rest.
              let bodyObj: any = json?.data
                ? JSON.parse(JSON.stringify(json.data))
                : {};
              const messagesKey = Object.keys(bodyObj).find((key) =>
                ["messages", "contents", "conversation", "history"].includes(
                  key
                )
              );
              if (messagesKey && Array.isArray(bodyObj[messagesKey])) {
                bodyObj[messagesKey] = buildDynamicMessages(
                  bodyObj[messagesKey],
                  [],
                  vars.TEXT,
                  []
                );
              }
              bodyObj = deepVariableReplacer(bodyObj, vars);

              // Belt-and-braces: strip any image field left empty.
              if (bodyObj && typeof bodyObj === "object") {
                for (const k of Object.keys(bodyObj)) {
                  const v = bodyObj[k];
                  if (
                    /image/i.test(k) &&
                    (v === "" ||
                      v === null ||
                      (Array.isArray(v) && v.length === 0))
                  ) {
                    delete bodyObj[k];
                  }
                }
              }
              const finalBody = JSON.stringify(bodyObj);

              const started = Date.now();
              const res = await fetch(url, {
                method: json?.method || "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(json?.header ?? {}),
                },
                body: finalBody,
              });
              const elapsed = Date.now() - started;
              const text = await res.text();
              if (!res.ok) {
                setTestState({
                  status: "error",
                  message: `HTTP ${res.status}: ${text.slice(0, 200)}`,
                });
                return;
              }
              setTestState({
                status: "ok",
                message: `Ответ за ${elapsed} мс. ${text.slice(0, 200)}`,
              });
            } catch (e) {
              setTestState({
                status: "error",
                message:
                  e instanceof Error ? e.message : "Unknown test error",
              });
            }
          }}
          disabled={testState.status === "testing"}
          className="w-full"
          variant={testState.status === "ok" ? "default" : "outline"}
        >
          {testState.status === "testing"
            ? "Тестирую…"
            : "🧪 Тест модели (проверить запрос)"}
        </Button>
        {testState.status === "ok" && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 break-words">
            ✓ {testState.message}
          </p>
        )}
        {testState.status === "error" && (
          <p className="text-xs text-red-500 mt-1 break-words">
            ✗ {testState.message}
          </p>
        )}
      </div>
    </div>
  );
};
