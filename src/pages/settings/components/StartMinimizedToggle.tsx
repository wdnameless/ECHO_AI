import { useCallback, useEffect, useState } from "react";
import { ZapIcon } from "lucide-react";
import { Label, Switch } from "@/components";
import { getStartMinimized, setStartMinimized } from "@/lib/storage/app-paths";

export const StartMinimizedToggle = () => {
  const [startMinimized, setStartMinimizedState] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const val = await getStartMinimized();
        if (!cancelled) setStartMinimizedState(val);
      } catch (err) {
        console.debug("Failed to read start_minimized:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = useCallback(async (enabled: boolean) => {
    try {
      setBusy(true);
      await setStartMinimized(enabled);
      setStartMinimizedState(enabled);
    } catch (err) {
      console.error("Failed to update start_minimized:", err);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
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
          disabled={busy}
          onCheckedChange={handleChange}
        />
      </div>
    </div>
  );
};
