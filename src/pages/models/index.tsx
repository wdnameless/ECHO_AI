import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CpuIcon,
  DownloadIcon,
  GlobeIcon,
  HardDriveIcon,
  LanguagesIcon,
  Loader2Icon,
  RadioIcon,
  RefreshCwIcon,
  SearchIcon,
  TrashIcon,
} from "lucide-react";
import { Button, Input, Label, Selection } from "@/components";
import { PageLayout } from "@/layouts";
import {
  deleteModel,
  downloadModel,
  formatSize,
  listModels,
  modelCatalog,
  selectModel,
  selectedModel,
  sttReadiness,
  type InstalledModel,
  type ModelDownloadProgress,
  type ModelEntry,
  type ModelFile,
  type SttReadiness,
} from "@/lib/storage/app-paths";

/**
 * Speech-model browser, laid out the way Handy presents its catalogue: one card
 * per model, search at the top, and a clear split between what is already on
 * disk and what can be downloaded.
 *
 * The catalogue is generated from Hugging Face (scripts/gen_catalog.py), so the
 * sizes, digests and published benchmarks cannot drift from what is actually
 * downloadable.
 */

/** Compact comparison bar, matching how Handy renders accuracy and speed. */
const Meter = ({ value, tone }: { value: number | null; tone: "accuracy" | "speed" }) => (
  <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
    <div
      className={`h-full rounded-full ${
        tone === "accuracy" ? "bg-emerald-500" : "bg-primary"
      }`}
      style={{ width: `${Math.max(4, Math.min(100, value ?? 0))}%` }}
    />
  </div>
);

/** Accuracy/speed pair shown on the right of a card. */
const Meters = ({ model }: { model: ModelEntry }) => (
  <div className="shrink-0 space-y-1.5 w-36">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-muted-foreground">точность</span>
      <Meter value={model.accuracy_score} tone="accuracy" />
    </div>
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-muted-foreground">скорость</span>
      <Meter value={model.speed_score} tone="speed" />
    </div>
  </div>
);

/** Capability row shared by both card kinds. */
const Meta = ({ model }: { model: ModelEntry }) => (
  <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
    <span className="flex items-center gap-1">
      <LanguagesIcon className="size-3" />
      {model.language_count > 1 ? `${model.language_count} языков` : "один язык"}
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
  </div>
);

const BADGE =
  "text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap";
const BADGE_RECOMMENDED = `${BADGE} bg-primary/15 text-primary`;
const BADGE_ACTIVE = `${BADGE} bg-emerald-500/15 text-emerald-600 dark:text-emerald-400`;

/** Sort orders offered above the list. */
const SORTS = [
  { value: "recommended", label: "По рекомендации" },
  { value: "speed", label: "По скорости" },
  { value: "accuracy", label: "По точности" },
  { value: "size", label: "По размеру" },
  { value: "languages", label: "По числу языков" },
] as const;

/** Languages worth filtering by; the catalogue reports 99 for Whisper alone. */
const LANGUAGE_FILTERS = [
  { value: "all", label: "Все языки" },
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "zh", label: "中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
] as const;

/** The quantisation the catalogue recommends for a model. */
function defaultFileOf(model: ModelEntry): ModelFile {
  return model.files.find((f) => f.filename === model.default_file) ?? model.files[0];
}

const Models = () => {
  const [catalog, setCatalog] = useState<ModelEntry[]>([]);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [active, setActive] = useState<InstalledModel | null>(null);
  const [readiness, setReadiness] = useState<SttReadiness | null>(null);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<string>("recommended");
  const [language, setLanguage] = useState<string>("all");

  /** Chosen quantisation per model; falls back to the catalogue default. */
  const [quantChoice, setQuantChoice] = useState<Record<string, string>>({});

  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [nextCatalog, nextInstalled, nextActive, ready] = await Promise.all([
      modelCatalog(),
      listModels(),
      selectedModel(),
      sttReadiness(),
    ]);
    setCatalog(nextCatalog);
    setInstalled(nextInstalled);
    setActive(nextActive);
    setReadiness(ready);
  }, []);

  useEffect(() => {
    void refresh().catch((err) => setNotice({ kind: "error", text: String(err) }));
  }, [refresh]);

  // Progress is pushed from the backend: a multi-gigabyte transfer must not be
  // polled for, and the UI must stay responsive while it runs.
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

  const startDownload = useCallback(
    (model: ModelEntry, file: ModelFile) =>
      void run(`download:${file.filename}`, async () => {
        await downloadModel(model.id, file.quant);
        setNotice({
          kind: "ok",
          text: `${model.name} (${file.quant}) скачана и проверена по SHA-256.`,
        });
      }),
    [run]
  );

  const useModel = useCallback(
    (model: InstalledModel) =>
      void run(`select:${model.file_name}`, async () => {
        await selectModel(model.path);
        setNotice({ kind: "ok", text: "Движок перезапущен на выбранной модели." });
      }),
    [run]
  );

  /** Models that have at least one file on disk. */
  const installedByFile = useMemo(() => {
    const map = new Map<string, InstalledModel>();
    for (const file of installed) map.set(file.file_name, file);
    return map;
  }, [installed]);

  const modelOfFile = useCallback(
    (file: InstalledModel) => catalog.find((m) => m.id === file.model_id),
    [catalog]
  );

  /** Catalogue entries with nothing downloaded yet. */
  const available = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const matches = catalog.filter((model) => {
      const downloaded = model.files.some((f) => installedByFile.has(f.filename));
      if (downloaded) return false;

      if (language !== "all") {
        const wanted = language.toLowerCase();
        const speaks = model.languages.some((code) =>
          code.toLowerCase().startsWith(wanted)
        );
        if (!speaks) return false;
      }

      if (!needle) return true;
      return (
        model.name.toLowerCase().includes(needle) ||
        model.id.toLowerCase().includes(needle) ||
        model.family.toLowerCase().includes(needle) ||
        model.description.toLowerCase().includes(needle)
      );
    });

    const by = (pick: (m: ModelEntry) => number) => (a: ModelEntry, b: ModelEntry) =>
      pick(b) - pick(a);

    switch (sort) {
      case "speed":
        return matches.sort(by((m) => m.speed_score ?? 0));
      case "accuracy":
        return matches.sort(by((m) => m.accuracy_score ?? 0));
      case "size":
        return matches.sort(
          by((m) => defaultFileOf(m)?.size_bytes ?? 0)
        );
      case "languages":
        return matches.sort(by((m) => m.language_count));
      default:
        // Catalogue order is already editorial: recommended first.
        return matches;
    }
  }, [catalog, installedByFile, language, query, sort]);

  const activeFile = active?.file_name ?? null;
  const recommended = catalog.find((m) => m.recommended) ?? catalog[0];

  const downloadingFile = progress?.file_name ?? null;

  return (
    <PageLayout
      title="Модели распознавания речи"
      description="Выберите модель или скачайте дополнительную. Разные модели отличаются точностью и скоростью."
    >
      <div id="models" className="space-y-4">
        {/* Engine state, so the page answers "will dictation work right now?" */}
        {readiness && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`size-2 rounded-full ${
                readiness.engine_running && readiness.model_found
                  ? "bg-emerald-500"
                  : "bg-amber-500"
              }`}
            />
            {readiness.engine_running && readiness.model_found
              ? `Движок работает · ${active?.file_name ?? "модель выбрана"}`
              : readiness.reason}
          </div>
        )}

        {readiness && !readiness.model_found && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <AlertCircleIcon className="size-4 text-amber-600 dark:text-amber-400" />
              <Label className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                Распознавание ещё не настроено
              </Label>
            </div>
            <p className="text-xs text-amber-700/90 dark:text-amber-400/90">
              Модель не входит в поставку — её нужно скачать один раз. Рекомендуем
              начать с «{recommended?.name}»: она распознаёт 28 языков, включая
              русский.
            </p>
            {recommended && (
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5"
                disabled={busy !== null}
                onClick={() => startDownload(recommended, defaultFileOf(recommended))}
              >
                <DownloadIcon className="size-3.5" />
                Скачать рекомендованную
              </Button>
            )}
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

        {/* Search */}
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск модели по названию…"
            className="h-10 pl-9"
          />
        </div>

        {/* Downloaded models */}
        {installed.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Скачанные модели
              </Label>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-[11px]"
                disabled={busy !== null}
                onClick={() => void run("refresh", async () => undefined)}
              >
                <RefreshCwIcon
                  className={`size-3 ${busy === "refresh" ? "animate-spin" : ""}`}
                />
                Обновить
              </Button>
            </div>

            {installed.map((file) => {
              const model = modelOfFile(file);
              const isActive = activeFile === file.file_name;
              return (
                <div
                  key={file.path}
                  className={`rounded-xl border p-4 space-y-2 ${
                    isActive ? "border-primary bg-primary/5" : "border-border/60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold truncate">
                          {model?.name ?? file.file_name}
                        </span>
                        {file.quant && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {file.quant}
                          </span>
                        )}
                        {isActive && <span className={BADGE_ACTIVE}>активна</span>}
                      </div>
                      {model && (
                        <p className="text-xs text-muted-foreground">
                          {model.description}
                        </p>
                      )}
                    </div>
                    {model && <Meters model={model} />}
                  </div>

                  {model && <Meta model={model} />}

                  <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/40">
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <HardDriveIcon className="size-3" />
                      {formatSize(file.size_bytes)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant={isActive ? "outline" : "default"}
                        className="h-7 text-[11px]"
                        disabled={busy !== null || isActive}
                        onClick={() => useModel(file)}
                      >
                        {isActive ? "Используется" : "Использовать"}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        disabled={busy !== null || isActive}
                        title="Удалить файл модели"
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
          </section>
        )}

        {/* Available to download */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Доступны для скачивания
            </Label>
            <div className="flex items-center gap-2">
              <div className="w-44">
                <Selection
                  selected={sort}
                  onChange={setSort}
                  options={SORTS.map((s) => ({ label: s.label, value: s.value }))}
                  placeholder="Сортировка"
                />
              </div>
              <div className="w-36">
                <Selection
                  selected={language}
                  onChange={setLanguage}
                  options={LANGUAGE_FILTERS.map((l) => ({
                    label: l.label,
                    value: l.value,
                  }))}
                  placeholder="Язык"
                />
              </div>
            </div>
          </div>

          {available.length === 0 && (
            <p className="text-xs text-muted-foreground py-6 text-center">
              Ничего не найдено. Измените запрос, язык или сортировку.
            </p>
          )}

          {available.map((model) => {
            const chosen =
              model.files.find((f) => f.quant === quantChoice[model.id]) ??
              defaultFileOf(model);
            const isDownloading = downloadingFile === chosen?.filename;

            return (
              <div
                key={model.id}
                className="rounded-xl border border-border/60 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{model.name}</span>
                      {model.recommended && (
                        <span className={BADGE_RECOMMENDED}>рекомендуется</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {model.description}
                    </p>
                  </div>
                  <Meters model={model} />
                </div>

                <Meta model={model} />

                <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/40">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {chosen ? formatSize(chosen.size_bytes) : "—"}
                    </span>
                    {model.files.length > 1 && (
                      <div className="w-32">
                        <Selection
                          selected={chosen?.quant ?? ""}
                          onChange={(value) =>
                            setQuantChoice((prev) => ({ ...prev, [model.id]: value }))
                          }
                          options={model.files.map((f) => ({
                            label: `${f.quant} · ${formatSize(f.size_bytes)}`,
                            value: f.quant,
                          }))}
                          placeholder="Вариант"
                        />
                      </div>
                    )}
                  </div>

                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    disabled={busy !== null || !chosen}
                    onClick={() => chosen && startDownload(model, chosen)}
                  >
                    {isDownloading ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                      <DownloadIcon className="size-3.5" />
                    )}
                    Скачать
                  </Button>
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
                      {formatSize(progress.downloaded)} /{" "}
                      {formatSize(progress.total)}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </PageLayout>
  );
};

export default Models;
