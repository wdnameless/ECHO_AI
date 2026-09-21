import { useState } from "react";
import { Header, Button, Selection, Card, Switch, Input, Label } from "@/components";
import { PlusIcon, SaveIcon, CodeIcon, SlidersIcon, CheckIcon, AlertCircleIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { fetchProviderModels } from "@/lib/functions/models.function";
import { useEffect } from "react";
import curl2Json from "@bany/curl-to-json";
import { getSecret, secretKey } from "@/lib/storage/secret-store";

interface EasyFormState {
  preset: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: string;
  streaming: boolean;
  responseContentPath: string;
}

const PRESET_DEFAULTS: Record<string, { name: string; baseUrl: string; defaultModel: string }> = {
  openai: {
    name: "OpenAI Compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
  },
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
  },
  nullform: {
    name: "Nullform Gateway",
    baseUrl: "https://ai-gateway.nullform.cv/v1",
    defaultModel: "gemini-3.8-flash-tiered",
  },
  ollama: {
    name: "Ollama (Local)",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3",
  },
  custom: {
    name: "Custom Provider",
    baseUrl: "",
    defaultModel: "",
  },
};

export const CreateEditProvider = ({
  customProviderHook,
}: {
  customProviderHook: any;
}) => {
  const {
    showForm,
    setShowForm,
    editingProvider,
    formData,
    setFormData,
    errors,
    handleSave,
    setErrors,
  } = customProviderHook;

  const [mode, setMode] = useState<"visual" | "raw">("visual");

  const [easyState, setEasyState] = useState<EasyFormState>({
    preset: "openai",
    name: "Custom AI Provider",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    maxTokens: "",
    streaming: true,
    responseContentPath: "choices[0].message.content",
  });

  const [testState, setTestState] = useState<{
    status: "idle" | "testing" | "ok" | "error";
    message: string;
  }>({ status: "idle", message: "" });

  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [showKey, setShowKey] = useState(false);

  const generateCurlFromEasy = (state: EasyFormState): string => {
    const cleanBase = state.baseUrl.trim().replace(/\/+$/, "");
    const fullUrl = cleanBase.endsWith("/chat/completions")
      ? cleanBase
      : `${cleanBase}/chat/completions`;

    const modelVal = state.model.trim() || "{{MODEL}}";
    // The template is stored in localStorage, so the key never goes into it: the
    // placeholder is resolved at request time from the OS secure store.
    const authHeader = `  -H "Authorization: Bearer {{API_KEY}}" \\\n`;

    let dataObj: any = {
      model: modelVal,
      messages: [
        { role: "system", content: "{{SYSTEM_PROMPT}}" },
        { role: "user", content: "{{TEXT}}" },
      ],
      stream: state.streaming,
    };

    if (state.maxTokens && !isNaN(Number(state.maxTokens))) {
      dataObj.max_tokens = Number(state.maxTokens);
    }

    return `curl ${fullUrl} \\\n  -H "Content-Type: application/json" \\\n${authHeader}  -d '${JSON.stringify(dataObj, null, 2)}'`;
  };

  const handleEasyChange = (updates: Partial<EasyFormState>) => {
    setEasyState((prev) => {
      const next = { ...prev, ...updates };
      const newCurl = generateCurlFromEasy(next);
      setFormData((f: any) => ({
        ...f,
        curl: newCurl,
        streaming: next.streaming,
        responseContentPath: next.responseContentPath || "choices[0].message.content",
      }));
      return next;
    });
  };

  const handleTestConnection = async () => {
    if (!easyState.baseUrl.trim()) {
      setTestState({ status: "error", message: "Укажите Base URL" });
      return;
    }

    setTestState({ status: "testing", message: "Тестирование подключения..." });
    try {
      const curl = generateCurlFromEasy(easyState);
      const vars: Record<string, string> = {};
      if (easyState.apiKey.trim()) {
        vars.API_KEY = easyState.apiKey.trim();
      }
      if (easyState.model.trim()) {
        vars.MODEL = easyState.model.trim();
      }

      const models = await fetchProviderModels(
        easyState.name || "custom",
        curl,
        vars
      );

      setFetchedModels(models);
      setTestState({
        status: "ok",
        message: `✓ Подключено! Загружено моделей: ${models.length}`,
      });
      if (models.length > 0 && !easyState.model.trim()) {
        handleEasyChange({ model: models[0] });
      }
    } catch (err) {
      setTestState({
        status: "error",
        message: err instanceof Error ? err.message : "Не удалось подключиться к провайдеру",
      });
    }
  };

  /**
   * Fills the visual fields from the provider being edited.
   *
   * Without this the form kept whatever values it had from the previous edit, and
   * saving rewrote the template with an unrelated endpoint and model.
   */
  useEffect(() => {
    if (!editingProvider) return;
    const parsed: any = curl2Json(formData.curl || "");
    const url: string = typeof parsed?.url === "string" ? parsed.url : "";
    const data: any = parsed?.data ?? {};
    const baseUrl = url.replace(/\/(chat\/completions|completions|messages)\/?$/i, "");
    const preset =
      Object.entries(PRESET_DEFAULTS).find(
        ([, config]) => config.baseUrl && baseUrl.startsWith(config.baseUrl)
      )?.[0] ?? "custom";

    setEasyState((prev) => ({
      ...prev,
      preset,
      baseUrl,
      // A placeholder is not a model name: leave the field empty for the user.
      model:
        typeof data.model === "string" && !data.model.includes("{{")
          ? data.model
          : "",
      maxTokens:
        data.max_tokens !== undefined && data.max_tokens !== null
          ? String(data.max_tokens)
          : "",
      streaming: formData.streaming ?? data.stream === true,
      responseContentPath:
        formData.responseContentPath || prev.responseContentPath,
    }));

    // Show the stored key so replacing it does not silently wipe it.
    let cancelled = false;
    void (async () => {
      const stored = await getSecret(secretKey.aiProvider(editingProvider));
      if (!cancelled) setEasyState((prev) => ({ ...prev, apiKey: stored ?? "" }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingProvider]);

  const handlePresetSelect = (presetKey: string) => {
    const config = PRESET_DEFAULTS[presetKey] || PRESET_DEFAULTS.custom;
    handleEasyChange({
      preset: presetKey,
      name: config.name,
      baseUrl: config.baseUrl,
      model: config.defaultModel,
    });
  };

  return (
    <>
      {!showForm ? (
        <Button
          onClick={() => {
            setShowForm(true);
            setErrors({});
            const initialCurl = generateCurlFromEasy(easyState);
            setFormData((prev: any) => ({
              ...prev,
              curl: prev.curl?.trim() ? prev.curl : initialCurl,
              responseContentPath: prev.responseContentPath || "choices[0].message.content",
            }));
          }}
          variant="outline"
          className="w-full h-11 border border-input/50 focus:border-primary/50 transition-colors"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          Добавить кастомный AI-провайдер
        </Button>
      ) : (
        <Card className="p-6 border bg-card/40 border-border/80 rounded-xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/50 pb-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {editingProvider ? "Редактирование провайдера" : "Подключение AI-провайдера"}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Настройте endpoint, API-ключ и выберите поддерживаемую модель
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-border/60 p-0.5 bg-muted/40">
                <button
                  type="button"
                  onClick={() => setMode("visual")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md font-medium transition-colors",
                    mode === "visual"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <SlidersIcon className="w-3.5 h-3.5" />
                  Удобная форма
                </button>
                <button
                  type="button"
                  onClick={() => setMode("raw")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md font-medium transition-colors",
                    mode === "raw"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <CodeIcon className="w-3.5 h-3.5" />
                  cURL
                </button>
              </div>
            </div>
          </div>

          {mode === "visual" ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-foreground">Пресет провайдера</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={testState.status === "testing"}
                    className="h-7 text-xs px-2.5 gap-1.5"
                  >
                    {testState.status === "testing" ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Проверка...
                      </>
                    ) : (
                      <>
                        <CheckIcon className="h-3 w-3" />
                        Тест подключения
                      </>
                    )}
                  </Button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: "nullform", label: "Nullform Gateway" },
                    { id: "openai", label: "OpenAI API" },
                    { id: "openrouter", label: "OpenRouter" },
                    { id: "ollama", label: "Ollama (Local)" },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handlePresetSelect(p.id)}
                      className={cn(
                        "text-xs px-3 py-2 rounded-lg border text-left transition-colors",
                        easyState.preset === p.id
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">API key *</Label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKey ? "text" : "password"}
                      placeholder="sk-..."
                      value={easyState.apiKey}
                      onChange={(e) => handleEasyChange({ apiKey: e.target.value })}
                      className="pr-16 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground hover:text-foreground font-medium"
                    >
                      {showKey ? "Скрыть" : "Показать"}
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Хранится в защищённом хранилище ОС и подставляется в запрос как
                  {" "}<code className="font-mono">{"{{API_KEY}}"}</code> — в cURL и localStorage ключ не попадает.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">Base URL *</Label>
                <Input
                  placeholder="https://api.openai.com/v1"
                  value={easyState.baseUrl}
                  onChange={(e) => handleEasyChange({ baseUrl: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-foreground">Model *</Label>
                  {fetchedModels.length > 0 ? (
                    <div className="space-y-1.5">
                      <Selection
                        selected={easyState.model}
                        options={fetchedModels.map((m) => ({ label: m, value: m }))}
                        placeholder="Выберите модель из списка"
                        onChange={(val) => handleEasyChange({ model: val })}
                      />
                      <Input
                        placeholder="Или укажите вручную..."
                        value={easyState.model}
                        onChange={(e) => handleEasyChange({ model: e.target.value })}
                        className="text-xs"
                      />
                    </div>
                  ) : (
                    <Input
                      placeholder="gemini-3.8-flash-tiered, gpt-4o..."
                      value={easyState.model}
                      onChange={(e) => handleEasyChange({ model: e.target.value })}
                      className="text-xs font-mono"
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-foreground">Max tokens (опционально)</Label>
                  <Input
                    type="number"
                    placeholder="4096"
                    value={easyState.maxTokens}
                    onChange={(e) => handleEasyChange({ maxTokens: e.target.value })}
                    className="text-xs font-mono"
                  />
                </div>
              </div>

              {testState.status !== "idle" && (
                <div
                  className={cn(
                    "p-2.5 rounded-lg text-xs flex items-center gap-2 border",
                    testState.status === "ok" && "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
                    testState.status === "error" && "bg-red-500/10 border-red-500/30 text-red-500",
                    testState.status === "testing" && "bg-muted border-border text-muted-foreground"
                  )}
                >
                  {testState.status === "ok" && <CheckIcon className="w-4 h-4 shrink-0" />}
                  {testState.status === "error" && <AlertCircleIcon className="w-4 h-4 shrink-0" />}
                  {testState.status === "testing" && <Loader2 className="w-4 h-4 shrink-0 animate-spin" />}
                  <span className="truncate">{testState.message}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <Header
                  title="Команда cURL *"
                  description="Сгенерированная команда вызова API провайдера."
                />
                <Textarea
                  className={cn("h-64 font-mono text-xs", errors.curl && "border-red-500")}
                  value={formData.curl}
                  onChange={(e) =>
                    setFormData((prev: any) => ({
                      ...prev,
                      curl: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="flex justify-between items-center space-x-2 pt-2 border-t border-border/40">
                <Header
                  title="Streaming"
                  description="Потоковая передача ответа от модели."
                />
                <Switch
                  checked={formData.streaming}
                  onCheckedChange={(checked) =>
                    setFormData((prev: any) => ({
                      ...prev,
                      streaming: checked,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Header
                  title="Путь к ответу (Response Content Path) *"
                  description="JSON-путь для извлечения текста ответа."
                />
                <Input
                  placeholder="choices[0].message.content"
                  value={formData.responseContentPath || ""}
                  onChange={(e) =>
                    setFormData((prev: any) => ({
                      ...prev,
                      responseContentPath: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2.5 pt-4 border-t border-border/50">
            <Button
              variant="outline"
              onClick={() => setShowForm(false)}
              className="h-10 text-xs px-4"
            >
              Отмена
            </Button>
            <Button
              onClick={() =>
                handleSave({ apiKey: easyState.apiKey, model: easyState.model })
              }
              disabled={!formData.curl?.trim()}
              className="h-10 text-xs px-5"
            >
              <SaveIcon className="h-3.5 w-3.5 mr-1.5" />
              {editingProvider ? "Обновить" : "Сохранить провайдер"}
            </Button>
          </div>
        </Card>
      )}
    </>
  );
};
