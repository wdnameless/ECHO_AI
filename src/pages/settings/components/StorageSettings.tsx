import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CpuIcon,
  DownloadIcon,
  FolderOpenIcon,
  GlobeIcon,
  HardDriveIcon,
  LanguagesIcon,
  Loader2Icon,
  PackageIcon,
  RadioIcon,
  RefreshCwIcon,
  SearchIcon,
  TrashIcon,
  ZapIcon,
} from "lucide-react";
import { Button, Header, Input, Label, Selection, Switch } from "@/components";
import {
  deleteModel,
  downloadModel,
  enablePortable,
  disablePortable,
  formatSize,
  getPaths,
  getStartMinimized,
  listModels,
  modelCatalog,
  pickDirectory,
  selectModel,
  selectedModel,
  setPaths,
  setStartMinimized,
  sttReadiness,
  type InstalledModel,
  type ModelDownloadProgress,
  type ModelEntry,
  type ModelFile,
  type ResolvedPaths,
  type SttReadiness,
} from "@/lib/storage/app-paths";

/**
 * Storage layout and speech-model management.
 *
 * The catalogue is generated from Hugging Face rather than hardcoded, so every
 * published model family is offered with its real size, accuracy and speed.
 * Models are downloaded on demand into a directory the user owns — the app no
 * longer carries a 700 MB model inside itself.
 */

/** Small bar used for the speed/accuracy comparison, as Handy renders it. */
const Meter = ({ value, tone }: { value: number | null; tone: "accuracy" | "speed" }) => {
  const filled = value ?? 0;
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${
            tone === "accuracy" ? "bg-emerald-500" : "bg-primary"
          }`}
          style={{ width: `${Math.max(4, Math.min(100, filled))}%` }}
        />
      </div>
    </div>
  );
};

/** One quantisation choice inside a model card. */
const FileChoice = ({
  file,
  model,
  onDownload,
  busy,
  disabled,
}: {
  file: ModelFile;
  model: ModelEntry;
  onDownload: (model: ModelEntry, file: ModelFile) => void;
  busy: boolean;
  disabled: boolean;
}) => (
  <div className="flex items-center justify-between gap-2 rounded border border-border/50 px-2 py-1.5">
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[11px] font-mono font-medium">{file.quant}</span>
      <span className="text-[10px] text-muted-foreground">
        {formatSize(file.size_bytes)}
      </span>
      {file.filename === model.default_file && (
        <span className="text-[9px] px-1 rounded bg-muted text-muted-foreground">
          по умолчанию
        </span>
      )}
    </div>
    <Button
      size="sm"
      variant="outline"
      className="h-6 px-2 text-[10px] gap-1 shrink-0"
      disabled={busy || disabled}
      onClick={() => onDownload(model, file)}
    >
      <DownloadIcon className="size-3" />
      Скачать
    </Button>
  </div>
);

export const StorageSettings = () => {
  const [paths, setResolvedPaths] = useState<ResolvedPaths | null>(null);
  const [catalog, setCatalog] = useState<ModelEntry[]>([]);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [active, setActive] = useState<InstalledModel | null>(null);
  const [startMinimized, setStartMinimizedState] = useState(false);
  const [readiness, setReadiness] = useState<SttReadiness | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null
  );
  const [query, setQuery] = useState("");
  const [familyFilter, setFamilyFilter] = useState("all");

  const refresh = useCallback(async () => {
    const [nextPaths, nextCatalog, nextInstalled, nextActive, minimized, ready] =
      await Promise.all([
        getPaths(),
        modelCatalog(),
        listModels(),
        selectedModel(),
        getStartMinimized(),
        sttReadiness(),
      ]);
    setResolvedPaths(nextPaths);
    setCatalog(nextCatalog);
    setInstalled(nextInstalled);
    setActive(nextActive);
    setStartMinimizedState(minimized);
    setReadiness(ready);
  }, []);

  useEffect(() => {
    void refresh().catch((err) =>
      setNotice({ kind: "error", text: String(err) })
    );
  }, [refresh]);

  // Download progress is pushed from the backend: a multi-gigabyte transfer
  // must not block the UI or be polled for.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<ModelDownloadProgress>("model-download-progress", (event) => {
      setProgress(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const run = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setBusy(label);
      setNotice(null);
      try {
        await action();
        await refresh();
      } catch (err) {
        setNotice({
          kind: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(null);
        setProgress(null);
      }
    },
    [refresh]
  );

  const download = useCallback(
    (model: ModelEntry, file: ModelFile) =>
      void run(`download:${model.id}:${file.quant}`, async () => {
        await downloadModel(model.id, file.quant);
        setNotice({
          kind: "ok",
          text: `${model.name} (${file.quant}) скачана и проверена по SHA-256.`,
        });
      }),
    [run]
  );

  const chooseDirectory = useCallback(
    async (field: "engine_dir" | "models_dir" | "logs_dir") => {
      const titles = {
        models_dir: "Каталог для моделей распознавания",
        engine_dir: "Каталог с движком распознавания",
        logs_dir: "Каталог для логов",
      } as const;
      const picked = await pickDirectory(titles[field]);
      if (!picked) return;
      await run("paths", () =>
        setPaths({
          engine_dir: field === "engine_dir" ? picked : paths?.engine_dir ?? null,
          models_dir: field === "models_dir" ? picked : paths?.models_dir ?? null,
          logs_dir: field === "logs_dir" ? picked : paths?.logs_dir ?? null,
        })
      );
    },
    [paths, run]
  );

  const families = useMemo(
    () => ["all", ...Array.from(new Set(catalog.map((m) => m.family))).sort()],
    [catalog]
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter((model) => {
      if (familyFilter !== "all" && model.family !== familyFilter) return false;
      if (!needle) return true;
      return (
        model.name.toLowerCase().includes(needle) ||
        model.id.toLowerCase().includes(needle) ||
        model.family.toLowerCase().includes(needle)
      );
    });
  }, [catalog, familyFilter, query]);

  /** Installed files, keyed for quick lookup. */
  const installedByFile = useMemo(() => {
    const map = new Map<string, InstalledModel>();
    for (const file of installed) map.set(file.file_name, file);
    return map;
  }, [installed]);

  const activeFile = active?.file_name ?? null;
  const recommended = catalog.find((m) => m.recommended) ?? catalog[0];

  return (
    <div id="storage" className="space-y-4">
      <Header
        title="Модели распознавания речи"
        description="Выберите модель или скачайте дополнительную. Разные модели отличаются точностью и скоростью."
        isMainTitle
      />

      {/* First-run state: the app ships without a model, so it must say so. */}
      {readiness && !readiness.model_found && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircleIcon className="size-4 text-amber-600 dark:text-amber-400" />
            <Label className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              Распознавание ещё не настроено
            </Label>
          </div>
          <p className="text-xs text-amber-700/90 dark:text-amber-400/90">
            Приложение больше не включает модель в поставку — её нужно скачать
            один раз. Рекомендуем начать с «{recommended?.name}»: она
            распознаёт 28 языков, включая русский.
          </p>
          <p className="text-[10px] font-mono text-muted-foreground break-all">
            каталог моделей: {readiness.models_dir}
          </p>
          {recommended && (
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              disabled={busy !== null}
              onClick={() => download(recommended, defaultFileOf(recommended))}
            >
              {busy?.startsWith("download:") ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <DownloadIcon className="size-3.5" />
              )}
              Скачать рекомендованную
            </Button>
          )}
        </div>
      )}

      {readiness?.model_found && !readiness.engine_running && (
        <div className="flex items-start gap-2 p-3 rounded-md text-sm border bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400">
          <AlertCircleIcon className="size-4 mt-0.5 shrink-0" />
          <span>{readiness.reason}</span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={`flex items-start gap-2 p-3 rounded-md text-sm border ${
            notice.kind === "ok"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
              : "bg-destructive/10 border-destructive/20 text-destructive"
          }`}
        >
          {notice.kind === "ok" ? (
            <CheckCircle2Icon className="size-4 mt-0.5 shrink-0" />
          ) : (
            <AlertCircleIcon className="size-4 mt-0.5 shrink-0" />
          )}
          <span className="break-words">{notice.text}</span>
        </div>
      )}

      {/* Already downloaded */}
      {installed.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Скачанные модели
          </Label>
          {installed.map((file) => {
            const isActive = activeFile === file.file_name;
            const model = catalog.find((m) => m.id === file.model_id);
            return (
              <div
                key={file.path}
                className={`rounded-lg border p-3 ${
                  isActive ? "border-primary bg-primary/5" : "border-border/60"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">
                        {model?.name ?? file.file_name}
                      </span>
                      {file.quant && (
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {file.quant}
                        </span>
                      )}
                      {isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2Icon className="size-2.5" /> активна
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {formatSize(file.size_bytes)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant={isActive ? "outline" : "default"}
                      className="h-7 text-[11px]"
                      disabled={busy !== null || isActive}
                      onClick={() =>
                        void run(`select:${file.file_name}`, async () => {
                          await selectModel(file.path);
                          setNotice({
                            kind: "ok",
                            text: "Движок перезапущен на выбранной модели.",
                          });
                        })
                      }
                    >
                      Использовать
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      disabled={busy !== null || isActive}
                      title="Удалить файл"
                      onClick={() =>
                        void run(`delete:${file.file_name}`, async () => {
                          setInstalled(await deleteModel(file.file_name));
                        })
                      }
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Catalogue */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Доступны для скачивания
          </Label>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-[11px]"
            disabled={busy !== null}
            onClick={() => void run("refresh", async () => undefined)}
          >
            {busy === "refresh" ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3" />
            )}
            Обновить
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск моделей по названию…"
              className="h-9 pl-7 text-xs"
            />
          </div>
          <div className="w-40 shrink-0">
            <Selection
              selected={familyFilter}
              onChange={setFamilyFilter}
              options={families.map((f) => ({
                label: f === "all" ? "Все семейства" : f,
                value: f,
              }))}
              placeholder="Семейство"
            />
          </div>
        </div>

        <div className="space-y-2">
          {visible.map((model) => {
            const defaultFile = defaultFileOf(model);
            const onDisk = model.files
              .map((f) => installedByFile.get(f.filename))
              .filter((f): f is InstalledModel => Boolean(f));
            const downloading = progress?.file_name
              ? model.files.some((f) => f.filename === progress.file_name)
              : false;

            return (
              <div
                key={model.id}
                className={`rounded-lg border p-3 space-y-2 ${
                  onDisk.some((f) => f.file_name === activeFile)
                    ? "border-primary bg-primary/5"
                    : "border-border/60"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{model.name}</span>
                      {model.recommended && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                          рекомендуется
                        </span>
                      )}
                      {onDisk.some((f) => f.file_name === activeFile) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                          активна
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {model.description}
                    </p>
                  </div>

                  <div className="shrink-0 space-y-1 w-32">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] text-muted-foreground">
                        точность
                      </span>
                      <Meter value={model.accuracy_score} tone="accuracy" />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] text-muted-foreground">
                        скорость
                      </span>
                      <Meter value={model.speed_score} tone="speed" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <LanguagesIcon className="size-3" />
                    {model.language_count > 1
                      ? `${model.language_count} языков`
                      : "один язык"}
                  </span>
                  {model.capabilities.streaming && (
                    <span className="flex items-center gap-1">
                      <RadioIcon className="size-3" />
                      живая
                    </span>
                  )}
                  {model.capabilities.translate && (
                    <span className="flex items-center gap-1">
                      <GlobeIcon className="size-3" />
                      перевод
                    </span>
                  )}
                  {model.wer !== null && (
                    <span className="font-mono">
                      WER {model.wer.toFixed(2)}%{model.wer_set ? ` (${model.wer_set})` : ""}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <CpuIcon className="size-3" />
                    {model.family}
                  </span>
                  {defaultFile && (
                    <span className="ml-auto">
                      {formatSize(defaultFile.size_bytes)}
                    </span>
                  )}
                </div>

                {/* Per-quantisation choice, as Handy offers on its cards. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                  {model.files.map((file) => {
                    const already = installedByFile.get(file.filename);
                    if (already) {
                      return (
                        <div
                          key={file.filename}
                          className="flex items-center justify-between gap-2 rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <CheckCircle2Icon className="size-3 text-emerald-500 shrink-0" />
                            <span className="text-[11px] font-mono font-medium">
                              {file.quant}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              скачана
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px] shrink-0"
                            disabled={
                              busy !== null || already.file_name === activeFile
                            }
                            onClick={() =>
                              void run(`select:${file.filename}`, async () => {
                                await selectModel(already.path);
                                setNotice({
                                  kind: "ok",
                                  text: "Движок перезапущен на выбранной модели.",
                                });
                              })
                            }
                          >
                            {already.file_name === activeFile
                              ? "активна"
                              : "Использовать"}
                          </Button>
                        </div>
                      );
                    }
                    return (
                      <FileChoice
                        key={file.filename}
                        file={file}
                        model={model}
                        busy={busy !== null}
                        disabled={paths?.writable === false}
                        onDownload={download}
                      />
                    );
                  })}
                </div>

                {downloading && progress && (
                  <div className="space-y-1">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{
                          width: `${
                            progress.total > 0
                              ? Math.min(
                                  100,
                                  Math.round(
                                    (progress.downloaded / progress.total) * 100
                                  )
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {formatSize(progress.downloaded)} / {formatSize(progress.total)}
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {visible.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">
              Ничего не найдено. Измените запрос или семейство.
            </p>
          )}
        </div>
      </div>

      {/* Layout */}
      <div className="rounded-xl border border-border/70 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <PackageIcon className="size-4 text-primary" />
              <Label className="text-sm font-semibold">Портативный режим</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Все файлы хранятся в одной папке рядом с приложением. Можно
              распаковать на флешку и переносить вместе с моделями.
            </p>
            {paths && (
              <p className="text-[10px] font-mono text-muted-foreground break-all pt-1">
                {paths.root_kind === "portable" ? "портативный" : "обычный"} ·{" "}
                {paths.root}
              </p>
            )}
          </div>
          <Switch
            checked={paths?.root_kind === "portable"}
            disabled={busy !== null}
            onCheckedChange={(enabled) =>
              run("portable", () => (enabled ? enablePortable() : disablePortable()))
            }
          />
        </div>
      </div>

      <div className="rounded-xl border border-border/70 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <HardDriveIcon className="size-4 text-primary" />
          <Label className="text-sm font-semibold">Каталоги</Label>
        </div>

        {paths && (
          <div className="space-y-2">
            {(
              [
                ["models_dir", "Модели", paths.models_dir],
                ["engine_dir", "Движок", paths.engine_dir],
                ["logs_dir", "Логи", paths.logs_dir],
              ] as const
            ).map(([field, label, value]) => (
              <div key={field} className="flex items-center gap-2">
                <div className="w-24 shrink-0">
                  <Label className="text-xs text-muted-foreground">{label}</Label>
                </div>
                <Input
                  readOnly
                  value={value}
                  className="h-8 text-[11px] font-mono"
                  title={value}
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="size-8 shrink-0"
                  disabled={busy !== null}
                  title={`Изменить: ${label}`}
                  onClick={() => chooseDirectory(field)}
                >
                  <FolderOpenIcon className="size-3.5" />
                </Button>
              </div>
            ))}

            {!paths.writable && (
              <p className="text-xs text-destructive">
                Каталог моделей недоступен для записи — загрузка работать не будет.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/50">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <ZapIcon className="size-3.5" />
              Запускать свёрнутым в трей
            </Label>
            <p className="text-xs text-muted-foreground">
              Окно не появляется при старте — приложение ждёт в трее.
            </p>
          </div>
          <Switch
            checked={startMinimized}
            disabled={busy !== null}
            onCheckedChange={(enabled) =>
              run("minimized", async () => {
                await setStartMinimized(enabled);
                setStartMinimizedState(enabled);
              })
            }
          />
        </div>
      </div>
    </div>
  );
};

/** The quantisation the catalogue recommends for a model. */
function defaultFileOf(model: ModelEntry): ModelFile {
  return model.files.find((f) => f.filename === model.default_file) ?? model.files[0];
}
