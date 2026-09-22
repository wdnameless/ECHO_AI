import { useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Button, Header } from "@/components";
import { PortableUpdateNotice, useIsPortable } from "@/components/updater/PortableUpdateNotice";
import { CheckCircle2Icon, DownloadIcon, Loader2Icon, RefreshCwIcon, AlertCircleIcon } from "lucide-react";

export const UpdateSettings = () => {
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const isPortable = useIsPortable();

  const handleCheck = async () => {
    setChecking(true);
    setError(null);
    setStatus(null);
    try {
      const found = await check();
      if (found) {
        setUpdate(found);
        setStatus(`Доступно обновление: v${found.version}`);
      } else {
        setUpdate(null);
        setStatus("У вас установлена актуальная версия приложения.");
      }
    } catch (err: any) {
      console.error("Update check failed:", err);
      setError(`Ошибка проверки: ${err?.message || String(err)}`);
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async () => {
    if (!update) return;
    setInstalling(true);
    setError(null);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (err: any) {
      console.error("Install update failed:", err);
      setError(`Ошибка установки: ${err?.message || String(err)}`);
      setInstalling(false);
    }
  };

  return (
    <div id="updates" className="space-y-3">
      <Header
        title="Обновления"
        description="Проверка наличия новых версий приложения Echo AI"
        isMainTitle
      />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-border/60 bg-muted/10">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Версия и релизы</span>
            {status && !error && !update && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2Icon className="w-3.5 h-3.5" />
                {status}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {update
              ? `Найдена новая версия v${update.version}. Нажмите «Установить и перезапустить».`
              : "Проверьте обновления вручную или скачайте свежий билд."}
          </p>

          {update && isPortable && (
            <div className="pt-2">
              <PortableUpdateNotice />
            </div>
          )}
          {error && (
            <p className="flex items-center gap-1 text-xs text-red-500 mt-1">
              <AlertCircleIcon className="w-3.5 h-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {update ? (
            <Button
              size="sm"
              onClick={handleInstall}
              disabled={installing}
              className="gap-2"
            >
              {installing ? (
                <>
                  <Loader2Icon className="w-4 h-4 animate-spin" />
                  Установка...
                </>
              ) : (
                <>
                  <DownloadIcon className="w-4 h-4" />
                  Установить v{update.version}
                </>
              )}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheck}
              disabled={checking}
              className="gap-2"
            >
              {checking ? (
                <>
                  <Loader2Icon className="w-4 h-4 animate-spin" />
                  Проверка...
                </>
              ) : (
                <>
                  <RefreshCwIcon className="w-4 h-4" />
                  Проверить обновления
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
