import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
} from "@/components";
import { HistoryIcon, Loader2Icon, CheckIcon } from "lucide-react";
import {
  getRetentionDays,
  setRetentionDays,
  cleanOldConversations,
} from "@/lib/retention";

export const RetentionSettings = () => {
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const val = await getRetentionDays();
        if (mounted) setDays(val);
      } catch (err) {
        console.error("Failed to load retention days:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = useCallback(
    async (newVal: number) => {
      try {
        setSaving(true);
        setSaved(false);
        await setRetentionDays(newVal);
        setDays(newVal);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err) {
        console.error("Failed to save retention days:", err);
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const handleCleanNow = useCallback(async () => {
    try {
      setCleaning(true);
      setCleanResult(null);
      const res = await cleanOldConversations(days);
      if (res.deletedConversations > 0) {
        setCleanResult(`Удалено ${res.deletedConversations} старых диалогов.`);
      } else {
        setCleanResult("Нет старых записей для удаления.");
      }
      setTimeout(() => setCleanResult(null), 3500);
    } catch (err) {
      console.error("Failed to clean old conversations:", err);
      setCleanResult("Ошибка при очистке");
    } finally {
      setCleaning(false);
    }
  }, [days]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HistoryIcon className="w-5 h-5 text-primary" />
          Хранение истории диалогов (Retention)
        </CardTitle>
        <CardDescription>
          Настройка срока хранения истории диалогов и сообщений. Старые записи
          автоматически удаляются при запуске приложения.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="retention-days" className="font-medium text-sm">
              Срок хранения (в днях)
            </Label>
            <p className="text-xs text-muted-foreground">
              0 — хранить историю бессрочно (без автоудаления)
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Input
              id="retention-days"
              type="number"
              min={0}
              max={3650}
              disabled={loading || saving}
              value={days}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                setDays(isNaN(val) ? 0 : Math.max(0, val));
              }}
              className="w-24 font-mono text-center"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={loading || saving}
              onClick={() => handleSave(days)}
            >
              {saving ? (
                <Loader2Icon className="w-4 h-4 animate-spin" />
              ) : saved ? (
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckIcon className="w-4 h-4" /> Сохранено
                </span>
              ) : (
                "Сохранить"
              )}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
          <span className="text-xs text-muted-foreground">Быстрый выбор:</span>
          {[7, 14, 30, 90, 0].map((d) => (
            <Button
              key={d}
              variant={days === d ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => {
                setDays(d);
                void handleSave(d);
              }}
            >
              {d === 0 ? "Бессрочно" : `${d} дней`}
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {cleanResult && (
              <span className="text-xs text-muted-foreground font-medium animate-fade-in">
                {cleanResult}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={cleaning || loading}
              onClick={handleCleanNow}
              className="h-7 text-xs"
            >
              {cleaning ? (
                <Loader2Icon className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : (
                <HistoryIcon className="w-3.5 h-3.5 mr-1" />
              )}
              Очистить сейчас
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
