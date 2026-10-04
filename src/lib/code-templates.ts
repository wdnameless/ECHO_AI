/**
 * Interview live-coding templates: plan phrase + hand-typable snippet + speak-aloud lines.
 *
 * Why this file exists: 80% of a tech interview is live coding (React from
 * scratch, debounce, fetch+errors, memo, classic algorithms). The spoken-answer
 * pipeline returns a 35-55 word monologue — useless at an editor. A code answer
 * is a plan phrase first ("Пишем дебаунс на 300мс с cleanup"), then a snippet
 * the candidate retypes by hand plus 2-3 lines to say aloud while typing.
 *
 * Matching is keyword-based and boring on purpose: the caller decides the mode
 * (manual button/hotkey), this file only picks WHICH template to inject.
 */

export interface CodeTemplate {
  /** Stable id, also used in tests. */
  id: string;
  /** Keywords (lowercase, any language) that select this template. */
  keywords: string[];
  /** One spoken phrase: what we are about to write. Shown immediately. */
  plan: string;
  /** Hand-typable snippet. No humanizer openers, no prose inside. */
  snippet: string;
  /** 2-3 lines to say aloud while typing. */
  narration: string[];
}

export const CODE_TEMPLATES: CodeTemplate[] = [
  {
    id: "debounce",
    keywords: ["дебаунс", "debounce", "задержк", "delay", "поиск при вводе", "search input"],
    plan: "Пишем дебаунс на 300мс с cleanup — классика для поиска при вводе.",
    snippet: `function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}`,
    narration: [
      "Держим таймер в эффекте, на каждое изменение сбрасываем.",
      "Cleanup обязателен — иначе setState на размонтированном компоненте.",
      "300 миллисекунд — баланс между отзывчивостью и числом запросов.",
    ],
  },
  {
    id: "throttle",
    keywords: ["тротлинг", "throttle", "скролл", "scroll", "resize", "ограничить частоту"],
    plan: "Троттлинг через timestamp — первый вызов сразу, остальные не чаще интервала.",
    snippet: `function useThrottle<T extends (...args: never[]) => void>(fn: T, limit = 300): T {
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(((...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = limit - (now - last.current);
    if (remaining <= 0) {
      last.current = now;
      fn(...args);
    } else if (!timer.current) {
      timer.current = setTimeout(() => {
        last.current = Date.now();
        timer.current = null;
        fn(...args);
      }, remaining);
    }
  }) as T, [fn, limit]);
}`,
    narration: [
      "Дебаунс ждёт тишины, троттлинг режет частоту — для скролла нужен второй.",
      "Первый вызов идёт сразу, остальное догоняет по таймеру.",
    ],
  },
  {
    id: "fetch-errors",
    keywords: ["fetch", "запрос", "ошибк", "error", "loading", "retry", "повтор", "аборт", "abort"],
    plan: "Фетч с loading, ошибкой и отменой по AbortController — recount гонки запросов.",
    snippet: `function useFetch<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(url, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json() as Promise<T>;
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [url]);

  return { data, loading, error };
}`,
    narration: [
      "AbortController в cleanup гасит гонку: старый ответ не перезапишет новый.",
      "Ошибку HTTP проверяем руками — fetch реджектит только сеть.",
    ],
  },
  {
    id: "list-search",
    keywords: ["список", "мап", "map", "поиск", "фильтр", "filter", "сортиров", "sort"],
    plan: "Список с поиском и сортировкой — всё через useMemo, фильтрация чистая.",
    snippet: `const visible = useMemo(() => {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((i) => i.title.toLowerCase().includes(q))
    : items;
  return [...filtered].sort((a, b) => a.title.localeCompare(b.title));
}, [items, query]);`,
    narration: [
      "Фильтр и сортировка — производные данные, считаем в useMemo.",
      "Исходный массив не мутируем — копируем перед sort.",
    ],
  },
  {
    id: "memo-cache",
    keywords: ["мемоиза", "memo", "usememo", "usecallback", "перерендер", "rerender", "оптимиза", "кэш"],
    plan: "Мемоизация: тяжёлый расчёт в useMemo, колбэки детям в useCallback.",
    snippet: `const total = useMemo(
  () => items.reduce((s, i) => s + i.price * i.qty, 0),
  [items]
);

const handleRemove = useCallback((id: string) => {
  setItems((prev) => prev.filter((i) => i.id !== id));
}, []);`,
    narration: [
      "Мемоизируем только то, что дорого считать или ломает memo детям.",
      "Функциональный setState — чтобы не тащить items в зависимости.",
    ],
  },
  {
    id: "group-by",
    keywords: ["группир", "group", "сгруппир", "по ключу", "агрегац"],
    plan: "Группировка через reduce в Map — линейное время, порядок сохраняется.",
    snippet: `function groupBy<T, K extends string | number>(
  arr: T[],
  key: (x: T) => K
): Record<K, T[]> {
  return arr.reduce((acc, x) => {
    const k = key(x);
    (acc[k] ??= []).push(x);
    return acc;
  }, {} as Record<K, T[]>);
}`,
    narration: [
      "Один проход, O(n) — объект как аккумулятор.",
      "Nullish assignment убирает проверку на существование ключа.",
    ],
  },
  {
    id: "valid-brackets",
    keywords: ["скобки", "bracket", "parentheses", "валидн", "стек", "stack"],
    plan: "Валидные скобки — стек: открывающие кладём, закрывающие сверяем.",
    snippet: `function isValid(s: string): boolean {
  const stack: string[] = [];
  const pair: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (const ch of s) {
    if ("([{".includes(ch)) stack.push(ch);
    else if (stack.pop() !== pair[ch]) return false;
  }
  return stack.length === 0;
}`,
    narration: [
      "Стек идеально ложится: последний открытый закрывается первым.",
      "В конце стек обязан быть пуст — иначе лишняя открывающая.",
    ],
  },
  {
    id: "promise-combinators",
    keywords: ["промис", "promise", "all", "race", "параллель", "одновременно", "асинхрон"],
    plan: "Параллельные запросы через Promise.all, первый ответ — через race.",
    snippet: `const [users, orders] = await Promise.all([
  fetch("/api/users").then((r) => r.json()),
  fetch("/api/orders").then((r) => r.json()),
]);

const fastest = await Promise.race([
  fetch(urlA),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), 5000)
  ),
]);`,
    narration: [
      "All ждёт всех — суммарное время равно самому медленному.",
      "Race с таймаутом — классика защиты от висящих запросов.",
    ],
  },
  {
    id: "refactor-module",
    keywords: ["рефактор", "refactor", "разбить", "вынести", "модуль", "чист"],
    plan: "Рефакторинг: выносим чистую логику из компонента, состояние — в хук.",
    snippet: `// Было: всё в компоненте. Стало: логика отдельно, компонент тонкий.
function useFilteredItems(items: Item[], query: string) {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.title.toLowerCase().includes(q)) : items;
  }, [items, query]);
}

function ItemList({ items, query }: { items: Item[]; query: string }) {
  const visible = useFilteredItems(items, query);
  return (
    <ul>
      {visible.map((i) => (
        <li key={i.id}>{i.title}</li>
      ))}
    </ul>
  );
}`,
    narration: [
      "Правило: компонент рендерит, хук считает — тестировать легко по частям.",
      "key по стабильному id, не по индексу — иначе поплывёт состояние строк.",
    ],
  },
  {
    id: "shallow-equal",
    keywords: ["сравнен", "equal", "shallow", "поверхност", "memo сравн", "areequal"],
    plan: "Поверхностное сравнение для React.memo — ловим только первый уровень.",
    snippet: `function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}`,
    narration: [
      "Ссылочное равенство первым — быстрый путь для того же объекта.",
      "Глубокое сравнение на каждый рендер дороже самого рендера.",
    ],
  },
  {
    id: "emitter",
    keywords: ["emitter", "эмиттер", "подписк", "subscribe", "событи", "event", "on off"],
    plan: "Мини-эмиттер на Map сетов — подписка, отписка функцией, аккуратный off.",
    snippet: `type Handler = (...args: never[]) => void;

function createEmitter() {
  const map = new Map<string, Set<Handler>>();
  return {
    on(event: string, fn: Handler) {
      if (!map.has(event)) map.set(event, new Set());
      map.get(event)!.add(fn);
      return () => map.get(event)?.delete(fn);
    },
    emit(event: string, ...args: never[]) {
      map.get(event)?.forEach((fn) => fn(...args));
    },
  };
}`,
    narration: [
      "Set вместо массива — отписка за O(1) и нет дублей.",
      "on возвращает unsubscribe — удобно в useEffect cleanup.",
    ],
  },
  {
    id: "lru-cache",
    keywords: ["lru", "кэш", "cache", "ограничен", "вытеснен", "memoize"],
    plan: "LRU-кэш на Map: порядок вставки = возраст, get освежает ключ.",
    snippet: `function createLRU<K, V>(limit = 100) {
  const map = new Map<K, V>();
  return {
    get(key: K): V | undefined {
      const v = map.get(key);
      if (v !== undefined) {
        map.delete(key);
        map.set(key, v);
      }
      return v;
    },
    set(key: K, value: V) {
      if (map.has(key)) map.delete(key);
      else if (map.size >= limit) map.delete(map.keys().next().value!);
      map.set(key, value);
    },
  };
}`,
    narration: [
      "Map помнит порядок вставки — самый старый всегда первый.",
      "Get с перезаписью делает ключ самым свежим.",
    ],
  },
];

/**
 * Picks a template by keyword hit. First match wins; templates are ordered
 * from most interview-frequent to least. Returns null when nothing matches —
 * the caller then uses the plain code prompt with no injected sample.
 */
export function matchCodeTemplate(question: string): CodeTemplate | null {
  const q = question.toLowerCase();
  return CODE_TEMPLATES.find((t) => t.keywords.some((k) => q.includes(k))) ?? null;
}

/**
 * Finds the most recent code-flavored request in the dialogue, newest first.
 *
 * Why: the candidate presses "Код" AFTER the discussion moved on — the freshest
 * line ("Mm-hmm", "Логично") has no code intent, but three messages ago the
 * interviewer said "Напиши функцию на псевдопитоне". Answering the freshest
 * line yields the generic fallback ("сначала каркас, потом детали") — correct
 * code path, wrong question. Scanning back finds the real task.
 *
 * A line "matches" when a template hits it OR it carries an explicit code verb
 * (напиши, write, implement, код, function, ...). Returns the text or null.
 */
const CODE_VERBS = [
  "напиши", "написать", "пиши", "реализуй", "реализов",
  "код", "функци", "function", "implement", "write the",
  "write a", "code it", "псевдо", "алгоритм", "скрипт",
  "компонент", "хук", "hook", "задани", "task",
];

export function findCodeRequestInHistory(texts: string[]): string | null {
  for (let i = texts.length - 1; i >= 0; i--) {
    const text = texts[i];
    if (!text || !text.trim()) continue;
    if (matchCodeTemplate(text)) return text;
    const q = text.toLowerCase();
    if (CODE_VERBS.some((v) => q.includes(v))) return text;
  }
  return null;
}
