import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FolderOpenIcon,
  HardDriveIcon,
  Loader2Icon,
  PackageIcon,
  RefreshCwIcon,
  TrashIcon,
} from "lucide-react";
import { Button, Header, Input, Label, Switch } from "@/components";
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
  type ModelVariant,
  type ResolvedPaths,
  type SttReadiness,
} from "@/lib/storage/app-paths";
import { useApp } from "@/contexts";

/**
 * Storage layout and local model management.
 *
 * Two things the app previously hid from the user: where its files live, and
 * which speech-recognition model it uses. Both are now editable, because the
 * model used to be welded into a 700 MB installer with no alternative, and the
 * directories were compiled-in constants.
 */
export const StorageSettings = () => {
  const { hasActiveLicense: _license } = useApp();

  const [paths, setResolvedPaths] = useState<ResolvedPaths | null>(null);
  const [catalog, setCatalog] = useState<ModelVariant[]>([]);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [active, setActive] = useState<InstalledModel | null>(null);
  const [startMinimized, setStartMinimizedState] = useState(false);
  const [readiness, setReadiness] = useState<SttReadiness | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null
  );

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

  const chooseDirectory = useCallback(
    async (field: "data_root" | "engine_dir" | "models_dir" | "logs_dir") => {
      const title =
        field === "models_dir"
          ? "Каталог для моделей распознавания"
          : field === "engine_dir"
          ? "Каталог с движком распознавания"
          : field === "logs_dir"
          ? "Каталог для логов"
          : "Каталог данных Echo AI";
      const picked = await pickDirectory(title);
      if (!picked) return;
      await run("paths", () =>
        setPaths({
          data_root: paths?.root_kind === "portable" ? paths.root : null,
          engine_dir: field === "engine_dir" ? picked : paths?.engine_dir ?? null,
          models_dir: field === "models_dir" ? picked : paths?.models_dir ?? null,
          logs_dir: field === "logs_dir" ? picked : paths?.logs_dir ?? null,
        })
      );
    },
    [paths, run]
  );

  const activeId = active?.variant_id ?? null;
  // Offered by the first-run banner; falls back to the smallest entry so the
  // button always has a target even if the catalogue marks nothing recommended.
  const defaultVariantId =
    catalog.find((v) => v.recommended)?.id ?? catalog[0]?.id ?? "q8_0";

  return (
    <div id="storage" className="space-y-4">
      <Header
        title="Хранилище и модели"
        description="Где лежат файлы приложения и какой моделью распознаётся речь"
        isMainTitle
      />

      {/* First-run state: the app starts with no model, so it must say so
          rather than leave the user with silent "offline" everywhere. */}
      {readiness && !readiness.model_found && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircleIcon className="size-4 text-amber-600 dark:text-amber-400" />
            <Label className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              Распознавание речи ещё не настроено
            </Label>
          </div>
          <p className="text-xs text-amber-700/90 dark:text-amber-400/90">
            Приложение больше не тащит модель внутри себя — её нужно скачать один
            раз. Выберите размер в списке ниже: маленькая модель займёт меньше
            места, большая распознаёт точнее.
          </p>
          <p className="text-[10px] font-mono text-muted-foreground break-all">
            каталог моделей: {readiness.models_dir}
          </p>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={busy !== null}
            onClick={() =>
              void run("first-model", async () => {
                await downloadModel(defaultVariantId);
                await selectModel(defaultVariantId);
                setNotice({
                  kind: "ok",
                  text: "Модель скачана, движок перезапущен. Диктовка готова.",
                });
              })
            }
          >
            {busy === "first-model" ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <DownloadIcon className="size-3.5" />
            )}
            Скачать рекомендованную модель
          </Button>
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

      {/* Portable mode */}
      <div className="rounded-xl border border-border/70 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <PackageIcon className="size-4 text-primary" />
              <Label className="text-sm font-semibold">Портативный режим</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Все файлы хранятся в одной папке рядом с приложением. Можно
              распаковать на флешку и переносить вместе с настройками и моделями.
            </p>
            {paths && (
              <p className="text-[10px] font-mono text-muted-foreground break-all pt-1">
                текущий режим:{" "}
                {paths.root_kind === "portable"
                  ? "портативный"
                  : "обычный (данные пользователя)"}
                {" · "}
                {paths.root}
              </p>
            )}
          </div>
          <Switch
            checked={paths?.root_kind === "portable"}
            disabled={busy !== null}
            onCheckedChange={(enabled) =>
              run("portable", () =>
                enabled ? enablePortable() : disablePortable()
              )
            }
          />
        </div>
      </div>

      {/* Directories */}
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
                ["engine_dir", "Движок распознавания", paths.engine_dir],
                ["logs_dir", "Логи", paths.logs_dir],
              ] as const
            ).map(([field, label, value]) => (
              <div key={field} className="flex items-center gap-2">
                <div className="w-44 shrink-0">
                  <Label className="text-xs text-muted-foreground">{label}</Label>
                </div>
                <Input
                  readOnly
                  value={value}
                  className="h-9 text-xs font-mono"
                  title={value}
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="size-9 shrink-0"
                  disabled={busy !== null}
                  title={`Изменить: ${label}`}
                  onClick={() => chooseDirectory(field)}
                >
                  <FolderOpenIcon className="size-4" />
                </Button>
              </div>
            ))}

            {!paths.writable && (
              <p className="text-xs text-destructive">
                Каталог моделей недоступен для записи — загрузка и переключение
                моделей работать не будут.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/50">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Запускать свёрнутым в трей</Label>
            <p className="text-xs text-muted-foreground">
              Окно не появляется при старте — приложение ждёт в трее, пока вы его
              не откроете.
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

      {/* Model catalogue */}
      <div className="rounded-xl border border-border/70 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <DownloadIcon className="size-4 text-primary" />
            <Label className="text-sm font-semibold">Модели распознавания</Label>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs"
            disabled={busy !== null}
            onClick={() => void run("refresh", async () => undefined)}
          >
            {busy === "refresh" ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
            Обновить
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Модель скачивается с Hugging Face и проверяется по SHA-256. Чем выше
          точность, тем больше файл — WER ниже значит лучше.
        </p>

        <div className="space-y-2">
          {catalog.map((variant) => {
            const onDisk = installed.find((m) => m.variant_id === variant.id);
            const isActive = activeId === variant.id;
            const isDownloading =
              busy === `download:${variant.id}` || progress?.file_name === variant.file_name;

            return (
              <div
                key={variant.id}
                className={`rounded-lg border p-3 space-y-2 ${
                  isActive ? "border-primary bg-primary/5" : "border-border/60"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">
                        {variant.quantisation}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {formatSize(variant.size_bytes)}
                      </span>
                      {variant.recommended && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                          как в установщике
                        </span>
                      )}
                      {isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2Icon className="size-2.5" /> используется
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{variant.note}</p>
                    {(variant.wer_librispeech !== null ||
                      variant.wer_fleurs_ru !== null) && (
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {variant.wer_librispeech !== null &&
                          `WER en ${variant.wer_librispeech.toFixed(2)}%`}
                        {variant.wer_librispeech !== null &&
                          variant.wer_fleurs_ru !== null &&
                          " · "}
                        {variant.wer_fleurs_ru !== null &&
                          `WER ru ${variant.wer_fleurs_ru.toFixed(2)}%`}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {onDisk ? (
                      <>
                        <Button
                          size="sm"
                          variant={isActive ? "outline" : "default"}
                          className="h-8 text-xs"
                          disabled={busy !== null || isActive}
                          onClick={() =>
                            void run(`select:${variant.id}`, async () => {
                              await selectModel(variant.id);
                              setNotice({
                                kind: "ok",
                                text: `Движок перезапущен на модели ${variant.quantisation}.`,
                              });
                            })
                          }
                        >
                          Использовать
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          disabled={busy !== null || isActive}
                          title="Удалить файл модели"
                          onClick={() =>
                            void run(`delete:${variant.id}`, async () => {
                              const remaining = await deleteModel(onDisk.file_name);
                              setInstalled(remaining);
                            })
                          }
                        >
                          <TrashIcon className="size-3.5" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-8 text-xs gap-1.5"
                        disabled={busy !== null || paths?.writable === false}
                        onClick={() =>
                          void run(`download:${variant.id}`, async () => {
                            await downloadModel(variant.id);
                            setNotice({
                              kind: "ok",
                              text: `Модель ${variant.quantisation} скачана и проверена.`,
                            });
                          })
                        }
                      >
                        {isDownloading ? (
                          <Loader2Icon className="size-3.5 animate-spin" />
                        ) : (
                          <DownloadIcon className="size-3.5" />
                        )}
                        Скачать
                      </Button>
                    )}
                  </div>
                </div>

                {isDownloading && progress && (
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
        </div>

        {/* Models found on disk that are not part of the catalogue */}
        {installed.filter((m) => !m.variant_id).length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border/50">
            <Label className="text-xs text-muted-foreground">
              Другие файлы моделей в каталоге
            </Label>
            {installed
              .filter((m) => !m.variant_id)
              .map((model) => (
                <div
                  key={model.path}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="font-mono truncate" title={model.path}>
                    {model.file_name}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-muted-foreground">
                      {formatSize(model.size_bytes)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      disabled={busy !== null || active?.path === model.path}
                      onClick={() =>
                        void run(`select-path`, async () => {
                          await selectModel(model.path);
                          setNotice({
                            kind: "ok",
                            text: "Движок перезапущен на выбранной модели.",
                          });
                        })
                      }
                    >
                      Использовать
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};
