# Interfaces — Plan remainder

## F1

```ts
// src/lib/prompt-builder.ts — порядок фиксирован:
// [base, thought?, filter, visual?, length, humanizer, opener, resume, job, memory, language, evolution?, search?]
// Статика (до memory) байт-стабильна при тех же входах.
```

```rust
// src-tauri/src/db/main.rs — тест:
#[test] fn test_wal_pragmas_applied() // journal_mode==wal на тестовой БД
```

| Файл | Владелец |
|---|---|
| `src/lib/prompt-builder.ts` | F1 |
| `src-tauri/src/db/main.rs` (только тест) | F1 |

## F2

```rust
// src-tauri/src/net_warm.rs (новый, или в lib.rs)
#[tauri::command] pub async fn warm_llm_connection(url: String) -> Result<u64, String>; // rtt ms
```

```ts
// WS-хуки: partial translation state + debounced translate call (400ms)
```

| Файл | Владелец |
|---|---|
| `src-tauri/src/net_warm.rs` | F2 |
| `src/hooks/useThemWsStreaming.ts` (+mic при симметрии) | F2 |

## F3

```
scripts/bench/
  corpus.json   — 20-30 эталонных пар (транскрипт → ожидание)
  bench.mjs     — метрики: WER-proxy, TTFT-proxy, lang-точность; `npm run bench`
```

Pro-удаление: `src/lib/entitlements.ts` (стать заглушкой `isPro=() => true`?
Нет — удалить файл + всех потребителей перевести на прямой доступ),
`src/components/UpgradePrompt/` удалить, гейты в хуках/страницах выпрямить.

| Файл | Владелец |
|---|---|
| `scripts/bench/*` | F3 |
| `src/lib/entitlements.ts` + потребители | F3 |
| `openspec/**` (T7) | оркестратор |
