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
import {
  PlusIcon,
  Trash2Icon,
  BookAIcon,
  SearchIcon,
  Loader2Icon,
} from "lucide-react";
import {
  loadCorrections,
  addCorrection,
  deleteCorrection,
  type AsrCorrection,
} from "@/lib/vocab";

export const ASRDictionarySettings = () => {
  const [corrections, setCorrections] = useState<AsrCorrection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [wrongInput, setWrongInput] = useState("");
  const [rightInput, setRightInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCorrections = useCallback(async () => {
    try {
      setLoading(true);
      const items = await loadCorrections(true);
      setCorrections([...items]);
    } catch (err) {
      console.error("Failed to load ASR corrections:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCorrections();
  }, [fetchCorrections]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanWrong = wrongInput.trim();
    const cleanRight = rightInput.trim();
    if (!cleanWrong || !cleanRight) return;

    setError(null);
    setIsSubmitting(true);
    try {
      await addCorrection(cleanWrong, cleanRight);
      setWrongInput("");
      setRightInput("");
      await fetchCorrections();
    } catch (err) {
      console.error("Failed to add ASR correction:", err);
      setError("Не удалось добавить исправление");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id?: number) => {
    if (id === undefined) return;
    try {
      await deleteCorrection(id);
      await fetchCorrections();
    } catch (err) {
      console.error("Failed to delete ASR correction:", err);
    }
  };

  const filtered = corrections.filter((c) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      c.wrong.toLowerCase().includes(q) || c.right.toLowerCase().includes(q)
    );
  });

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <BookAIcon className="w-4 h-4 text-violet-500" />
              Пользовательский словарь ASR
            </CardTitle>
            <CardDescription className="text-xs">
              Автоматическая автокоррекция распознавания речи и подсказки для ASR
            </CardDescription>
          </div>
          <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
            {corrections.length} слов
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Add Form */}
        <form onSubmit={handleAdd} className="space-y-3 p-3 rounded-lg border bg-muted/20">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Добавить замену
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Как слышит ASR (ошибка):</Label>
              <Input
                placeholder="например: кверти"
                value={wrongInput}
                onChange={(e) => setWrongInput(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Как должно быть (правильно):</Label>
              <Input
                placeholder="например: Qwerty"
                value={rightInput}
                onChange={(e) => setRightInput(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting || !wrongInput.trim() || !rightInput.trim()}
              className="h-8 text-xs gap-1.5"
            >
              {isSubmitting ? (
                <Loader2Icon className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <PlusIcon className="w-3.5 h-3.5" />
              )}
              Добавить
            </Button>
          </div>
        </form>

        {/* Search & List */}
        <div className="space-y-2">
          {corrections.length > 5 && (
            <div className="relative">
              <SearchIcon className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Поиск по словарю..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground text-xs gap-2">
              <Loader2Icon className="w-4 h-4 animate-spin" />
              Загрузка словаря...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-6 border border-dashed rounded-lg text-xs text-muted-foreground">
              {search ? "Ничего не найдено" : "Словарь пуст. Добавьте свои первые исправления выше."}
            </div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto space-y-1.5 pr-1">
              {filtered.map((item) => (
                <div
                  key={item.id ?? `${item.wrong}-${item.right}`}
                  className="flex items-center justify-between p-2 rounded-md border bg-card hover:bg-muted/40 transition-colors text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                    <span className="line-through text-muted-foreground/80 truncate max-w-[150px]" title={item.wrong}>
                      {item.wrong}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-medium text-foreground truncate max-w-[180px]" title={item.right}>
                      {item.right}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(item.id)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                    title="Удалить"
                  >
                    <Trash2Icon className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
