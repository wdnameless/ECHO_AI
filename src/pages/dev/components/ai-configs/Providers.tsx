import { Button, Header, Input, Selection, TextInput } from "@/components";
import { UseSettingsReturn } from "@/types";
import curl2Json, { ResultJSON } from "@bany/curl-to-json";
import { Loader2, RefreshCw, TrashIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  buildDynamicMessages,
  deepVariableReplacer,
} from "@/lib/functions/common.function";
import { fetchProviderModels } from "@/lib/functions/models.function";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getSecret, saveSecret, removeSecret, secretKey } from "@/lib/storage/secret-store";

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

  // Cached fetched models per provider ID: { [providerId]: string[] }
  const [cachedModels, setCachedModels] = useState<Record<string, string[]>>({});
  const [fetchState, setFetchState] = useState<
    | { status: "idle" | "fetching" }
    | { status: "ok" | "error"; message: string }
  >({ status: "idle" });

  const providerId = selectedAIProvider?.provider || "";
  const apiKeyVar = variables?.find((v) => v?.key === "api_key");

  /**
   * Values typed for each provider, keyed by provider id.
   *
   * Switching the provider used to reset `variables` to `{}`, so the model and
   * reasoning effort the user had entered were silently lost the moment they
   * looked at another provider and switched back.
   */
  const [variablesByProvider, setVariablesByProvider] = useState<
    Record<string, Record<string, string>>
  >({});

  const selectProvider = useCallback(
    (value: string) => {
      setVariablesByProvider((prev) => ({
        ...prev,
        [providerId]: selectedAIProvider?.variables ?? {},
      }));
      const remembered = variablesByProvider[value] ?? {};
      onSetSelectedAIProvider({ provider: value, variables: { ...remembered } });
    },
    [onSetSelectedAIProvider, providerId, selectedAIProvider?.variables, variablesByProvider]
  );

  /**
   * Ключ не хранится в настройках провайдера (иначе он уезжает в открытый
   * localStorage), поэтому поле ввода читает его из защищённого хранилища.
   */
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!providerId || !apiKeyVar) {
        setApiKey("");
        return;
      }
      const stored = await getSecret(secretKey.aiProvider(providerId));
      if (!cancelled) setApiKey(stored ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [providerId, apiKeyVar]);

  const persistApiKey = useCallback(
    async (value: string) => {
      if (!providerId) return;
      setApiKey(value);
      const trimmed = value.trim();
      if (trimmed) {
        await saveSecret(secretKey.aiProvider(providerId), trimmed);
      } else {
        await removeSecret(secretKey.aiProvider(providerId));
      }
    },
    [providerId]
  );

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

  /**
   * Reads a provider variable by the descriptor key.
   *
   * `extractVariables` lower-cases descriptor keys (`model`), while the stored
   * selection is canonicalised to `MODEL`. Looking the key up verbatim therefore
   * always missed, and the field rendered empty even though the value was saved.
   */
  const readVariable = useCallback(
    (key: string): string => {
      const stored = selectedAIProvider?.variables ?? {};
      if (key in stored) return stored[key];
      const upper = key.toUpperCase();
      if (upper in stored) return stored[upper];
      const match = Object.keys(stored).find((k) => k.toUpperCase() === upper);
      return match ? stored[match] : "";
    },
    [selectedAIProvider?.variables]
  );

  /** Writes under the canonical UPPER_CASE key, so read and request paths agree. */
  const writeVariable = useCallback(
    (key: string, value: string) => {
      if (!selectedAIProvider) return;
      const upper = key.toUpperCase();
      const next: Record<string, string> = { ...selectedAIProvider.variables };
      // Drop any case-variant so canonicalisation cannot resurrect a stale value.
      for (const existing of Object.keys(next)) {
        if (existing !== upper && existing.toUpperCase() === upper) delete next[existing];
      }
      next[upper] = value;
      onSetSelectedAIProvider({ ...selectedAIProvider, variables: next });
    },
    [onSetSelectedAIProvider, selectedAIProvider]
  );

  const currentProviderId = selectedAIProvider?.provider || "";
  const providerModels = cachedModels[currentProviderId] || [];

  const handleFetchModels = async () => {
    const provider = allAiProviders?.find(
      (p) => p?.id === selectedAIProvider?.provider
    );
    if (!provider || !provider.id || !provider.curl) {
      setFetchState({
        status: "error",
        message: "Провайдер не выбран или отсутствует шаблон curl",
      });
      return;
    }
    const providerId = provider.id;

    setFetchState({ status: "fetching" });
    try {
      const vars: Record<string, string> = {
        ...(selectedAIProvider?.variables ?? {}),
      };
      const models = await fetchProviderModels(
        providerId,
        provider.curl,
        vars
      );
      setCachedModels((prev) => ({
        ...prev,
        [providerId]: models,
      }));
      setFetchState({
        status: "ok",
        message: `Загружено моделей: ${models.length}`,
      });
    } catch (e) {
      setFetchState({
        status: "error",
        message: e instanceof Error ? e.message : "Не удалось получить список моделей",
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">Активный провайдер</p>
        <Selection
          selected={selectedAIProvider?.provider}
          options={allAiProviders?.map((provider) => {
            const json = curl2Json(provider?.curl);
            const providerRecord = provider as unknown as Record<string, unknown>;
            const providerName = typeof providerRecord?.name === "string" ? providerRecord.name : undefined;
            return {
              label:
                providerName ||
                (provider?.isCustom
                  ? json?.url || provider?.id || "Custom Provider"
                  : provider?.id || "Custom Provider"),
              value: provider?.id || "Custom Provider",
              isCustom: provider?.isCustom,
            };
          })}
          placeholder="Choose your AI provider"
          onChange={(value) => {
            selectProvider(value);
            setFetchState({ status: "idle" });
          }}
        />
      </div>

      {localSelectedProvider ? (
        <p className="text-[11px] text-muted-foreground break-all">
          {localSelectedProvider?.method || "?"} {localSelectedProvider?.url || "URL не задан"}
        </p>
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
        {variables
          .filter(
            (variable) => variable.key !== findKeyAndValue("api_key")?.key
          )
          .map((variable) => {
            const getVariableValue = () => {
              if (!variable?.key) return "";
              return readVariable(variable.key);
            };

            const isModelVar = variable?.key?.toLowerCase() === "model";

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
                <div className="space-y-2">
                  <div className="flex gap-2 items-center">
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
                        if (!variable?.key) return;
                        writeVariable(variable.key, value);
                      }}
                    />
                    {isModelVar && (
                      <Button
                        type="button"
                        onClick={handleFetchModels}
                        disabled={fetchState.status === "fetching"}
                        className="shrink-0 h-11 px-3 gap-2"
                        variant="outline"
                        title="Fetch models from provider"
                      >
                        {fetchState.status === "fetching" ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="hidden sm:inline">Fetching…</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4" />
                            <span className="hidden sm:inline">Fetch models</span>
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  {isModelVar && fetchState.status === "ok" && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      ✓ {fetchState.message}
                    </p>
                  )}
                  {isModelVar && fetchState.status === "error" && (
                    <p className="text-xs text-red-500 break-words">
                      ✗ {fetchState.message}
                    </p>
                  )}

                  {isModelVar && providerModels.length > 0 && (
                    <div className="space-y-1">
                      <Selection
                        selected={getVariableValue()}
                        options={providerModels.map((m) => ({
                          label: m,
                          value: m,
                        }))}
                        placeholder="Select fetched model or keep custom input above"
                        onChange={(value) => {
                          if (!variable?.key) return;
                          writeVariable(variable.key, value);
                        }}
                      />
                    </div>
                  )}
                </div>
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

              // Resolve variables from the selected provider config. Ключ в
              // настройках не хранится — подставляем его из защищённого
              // хранилища, иначе тест ушёл бы без авторизации.
              const vars: Record<string, string> = {
                ...(selectedAIProvider?.variables ?? {}),
                TEXT: "Привет! Это тестовый запрос. Ответь одним коротким предложением.",
                SYSTEM_PROMPT: "Ты — ассистент. Отвечай кратко.",
              };
              const keyVar = variables?.find((v) => v?.key === "api_key");
              if (keyVar?.key) {
                const storedKey = await getSecret(
                  secretKey.aiProvider(providerId)
                );
                if (storedKey) {
                  vars[keyVar.key] = storedKey;
                  vars.API_KEY = storedKey;
                }
              }
              const modelVar = Object.keys(vars).find(
                (k) => k.toLowerCase() === "model"
              );
              if (modelVar) vars[modelVar] = vars[modelVar] || "test";

              // Build the body exactly like the real pipeline: dynamic
              // messages ({{TEXT}}/{{IMAGE}} handled properly — empty image
              // parts are REMOVED, not left as empty strings) + variable
              // replacement for the rest.
              let bodyObj: Record<string, unknown> = json?.data
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
              const res = await tauriFetch(url, {
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
