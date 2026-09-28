import { useEffect, useState } from "react";
import { getPaths } from "@/lib/storage/app-paths";

/**
 * True when the running copy keeps its data next to the executable.
 *
 * A portable install is updated into the normal install location, not in place,
 * so anything that offers an update has to know which layout it is talking to.
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
 * Warning shown before an update is installed from a portable copy.
 *
 * The installer puts the app in the system location and starts it with a fresh
 * data directory: settings, engine and downloaded models from the portable folder
 * do not move across, and the app comes back without its model — which reads as
 * "the update broke it". Saying so up front, with the way to stay portable, is the
 * difference between a surprise and a choice.
 */
export const PortableUpdateNotice = () => (
  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1.5">
    <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
      Приложение запущено в портативном режиме
    </p>
    <p className="text-xs text-muted-foreground leading-relaxed">
      Обновление установит обычную копию в системный каталог. Она запустится со
      своей папкой данных: настройки, движок и скачанные модели из портативной
      папки в неё не переедут — модель придётся указать заново.
    </p>
    <p className="text-xs text-muted-foreground leading-relaxed">
      Чтобы остаться портативным, скачайте архив{" "}
      <a
        href="https://github.com/wdnameless/ECHO_AI/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:text-blue-700 underline"
      >
        Echo.AI_..._portable_x64.zip
      </a>{" "}
      и замените им файл приложения.
    </p>
  </div>
);
