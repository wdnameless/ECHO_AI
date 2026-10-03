import { useEffect, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { getPaths } from "@/lib/storage/app-paths";

/**
 * Target key the updater looks up in `latest.json → platforms`.
 *
 * The default target on Windows resolves to `windows-x86_64-{msi,nsis}` and
 * installs into the system location. A portable copy must instead fetch the
 * zip published by CI under this key and apply it over its own folder.
 * MUST stay in sync with `release.yml` (the key CI writes).
 */
export const PORTABLE_UPDATE_TARGET = "windows-x86_64-portable";

/**
 * True when the running copy keeps its data next to the executable.
 * Used for notice display; it is not authoritative for selecting a package.
 */
export function useIsPortable(): boolean {
  const [isPortable, setIsPortable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const paths = await getPaths();
        if (!cancelled) setIsPortable(paths?.root_kind === "portable");
      } catch {
        /* on layout resolution error, do not show portable notice */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return isPortable;
}

/**
 * Checks for updates against the right target for this layout.
 *
 * Resolves actual native paths for EACH check. A portable copy checks the
 * zip target, an installed copy checks the default MSI/NSIS target.
 * Unknown layout rejects; no caller boolean determines target.
 */
export async function checkForUpdateForLayout(): Promise<Update | null> {
  const paths = await getPaths();
  if (paths?.root_kind === "portable") {
    return check({ target: PORTABLE_UPDATE_TARGET });
  }
  if (paths?.root_kind === "appdata") {
    return check();
  }
  throw new Error(`Unknown storage layout: ${String(paths?.root_kind)}`);
}

/**
 * Installs update according to current storage layout.
 *
 * Re-resolves layout at install time; never relies on stale rendered state.
 * - Installed: invokes update.downloadAndInstall, returns true (caller relaunches).
 * - Portable: invokes install_portable_update with expectedVersion and IPC Channel,
 *   forwards progress events, returns false (native helper owns restart).
 * - Unknown layout: rejects without modifying app files.
 */
export async function installUpdateForLayout(
  update: Update,
  onEvent?: (event: DownloadEvent) => void
): Promise<boolean> {
  const paths = await getPaths();
  if (paths?.root_kind === "portable") {
    const channel = new Channel<DownloadEvent>();
    if (onEvent) {
      channel.onmessage = onEvent;
    }
    await invoke("install_portable_update", {
      expectedVersion: update.version,
      onEvent: channel,
    });
    return false;
  }
  if (paths?.root_kind === "appdata") {
    await update.downloadAndInstall(onEvent);
    return true;
  }
  throw new Error(`Unknown storage layout: ${String(paths?.root_kind)}`);
}

/**
 * Warning shown before an update is installed from a portable copy.
 *
 * The update replaces the app files in place; `.echo-ai/` (settings, engine,
 * models and chat history) is preserved.
 */
export const PortableUpdateNotice = () => (
  <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-1.5">
    <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
      Приложение запущено в портативном режиме
    </p>
    <p className="text-xs text-muted-foreground leading-relaxed">
      Обновление заменит файлы приложения на месте. Настройки, движок и
      скачанные модели и история чатов в папке `.echo-ai` сохранятся.
      Смена режима хранения требует перезапуска: до него история записывается
      в текущую базу; перенос выполняется при следующем запуске.
    </p>
  </div>
);
