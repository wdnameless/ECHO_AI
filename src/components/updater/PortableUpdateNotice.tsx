import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
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
 *
 * A portable install used to be updated into the normal install location, not
 * in place, so anything that offers an update has to know which layout it is
 * talking to. Since portable in-place updates this decides WHICH package the
 * update button fetches, not whether to show a warning.
 */
export function useIsPortable(): boolean {
  const [isPortable, setIsPortable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const paths = await getPaths();
        if (!cancelled) setIsPortable(paths.root_kind === "portable");
      } catch {
        /* an unknown layout is treated as a normal install */
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
 * Portable copies ask for the zip target; installed copies use the default
 * (MSI/NSIS). One call site instead of two `check()` variants scattered over
 * the bar popover and Settings.
 */
export async function checkForUpdateForLayout(
  isPortable: boolean
): Promise<Update | null> {
  return isPortable
    ? check({ target: PORTABLE_UPDATE_TARGET })
    : check();
}

/**
 * Warning shown before an update is installed from a portable copy.
 *
 * The update replaces the app files in place; `.echo-ai/` (settings, engine,
 * downloaded models) is preserved. No manual zip juggling, no fresh data dir.
 */
export const PortableUpdateNotice = () => (
  <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-1.5">
    <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
      Приложение запущено в портативном режиме
    </p>
    <p className="text-xs text-muted-foreground leading-relaxed">
      Обновление заменит файлы приложения на месте. Настройки, движок и
      скачанные модели в папке `.echo-ai` сохранятся — ничего указывать заново
      не придётся.
    </p>
  </div>
);
