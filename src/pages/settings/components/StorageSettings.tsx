import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  FolderOpenIcon,
  HardDriveIcon,
  PackageIcon,
  ZapIcon,
} from "lucide-react";
import { Button, Header, Input, Label, Switch } from "@/components";
import {
  enablePortable,
  disablePortable,
  getPaths,
  getStartMinimized,
  listModels,
  pickDirectory,
  setPaths,
  setStartMinimized,
  sttReadiness,
  type InstalledModel,
  type ResolvedPaths,
  type SttReadiness,
} from "@/lib/storage/app-paths";

/**
 * Where the app keeps its files, and whether it travels as one folder.
 *
 * The model catalogue lives on its own page (`/models`) because it is browsed
 * often and the directory settings are configured once.
 */
export const StorageSettings = () => {
  const [paths, setResolvedPaths] = useState<ResolvedPaths | null>(null);
  const [startMinimized, setStartMinimizedState] = useState(false);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [readiness, setReadiness] = useState<SttReadiness | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null
  );

  const refresh = useCallback(async () => {
    const [nextPaths, minimized, models, ready] = await Promise.all([
      getPaths(),
      getStartMinimized(),
      listModels(),
      sttReadiness(),
    ]);
    setResolvedPaths(nextPaths);
    setStartMinimizedState(minimized);
    setInstalled(models);
    setReadiness(ready);
  }, []);

  useEffect(() => {
    void refresh().catch((err) =>
      setNotice({ kind: "error", text: String(err) })
    );
  }, [refresh]);

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
      }
    },
    [refresh]
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

  return (
    <div id="storage" className="space-y-4">
      <Header
        title="Хранилище и система"
        description="Расположение моделей, кэша и режим работы приложения"
        isMainTitle
      />

      {notice && (
        <div
          role="status"
          className={`flex items-start gap-2 p-3 rounded-md text-sm border ${
            notice.kind === "ok"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
              : "bg-destructive/10 border-destructive/20 text-destructive"
          }`}
        >
          <CheckCircle2Icon className="size-4 mt-0.5 shrink-0" />
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

      {/* Directories */}
      <div className="rounded-xl border border-border/70 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <HardDriveIcon className="size-4 text-primary" />
          <Label className="text-sm font-semibold">Каталоги</Label>
        </div>

        {paths ? (
          <div className="space-y-2.5">
            {(
              [
                ["models_dir", "Модели", paths.models_dir],
                ["engine_dir", "Движок", paths.engine_dir],
                ["logs_dir", "Логи", paths.logs_dir],
              ] as const
            ).map(([field, label, value]) => (
              <div key={field} className="flex items-center gap-3">
                <div className="w-20 shrink-0">
                  <span className="text-xs font-medium text-foreground">{label}</span>
                </div>
                <Input
                  readOnly
                  value={value}
                  className="h-8 text-[11px] font-mono bg-muted/40"
                  title={value}
                />
                <Button
                  size="icon"
                  variant="secondary"
                  className="size-8 shrink-0 hover:bg-secondary/80"
                  disabled={busy !== null}
                  title={`Выбрать папку: ${label}`}
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
        ) : (
          <p className="text-xs text-muted-foreground">Загрузка расположения…</p>
        )}
      </div>

      {/* Engine state */}
      <div className="rounded-xl border border-border/70 p-4 space-y-2">
        <Label className="text-sm font-semibold">Состояние распознавания</Label>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={`size-2 rounded-full ${
              readiness?.engine_running && readiness.model_found
                ? "bg-emerald-500"
                : "bg-amber-500"
            }`}
          />
          {readiness?.engine_running && readiness.model_found
            ? "Движок работает, модель загружена"
            : readiness?.reason ?? "Проверка…"}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {installed.length > 0
            ? `Файлов моделей в каталоге: ${installed.length}`
            : "Моделей пока нет — скачайте на странице «Модели»."}
        </p>
      </div>

      {/* Start minimised */}
      <div className="rounded-xl border border-border/70 p-4">
        <div className="flex items-center justify-between gap-3">
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
