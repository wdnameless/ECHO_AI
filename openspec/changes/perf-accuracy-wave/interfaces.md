# Interfaces — Perf+Accuracy wave (F1–F6)

Границы и зоны владения. Сигнатуры существующих функций НЕ меняются (внутренние
оптимизации); новые экспорты только там, где нужны тестам.

## F1 — поиск-параллель (R01)

```ts
// src/lib/functions/parallel-search.ts — уже есть, подключить:
// export function parallelSearchStream(...) — onLate-кэш при победе токенов
// src/lib/functions/ai-response.function.ts:887 — заменить сериальный race на параллель
```

| Файл | Владелец |
|---|---|
| `src/lib/functions/ai-response.function.ts` (блок ~887) | F1, затем F3 (другой участок ~328) |
| `src/lib/functions/parallel-search.ts` | F1 |

## F2 — ассемблер (R02, R09)

```ts
// src/lib/question-assembler.ts — внутренняя логика:
// static looksUnfinished(text): boolean — сузить (сигнатура та же)
// push(): tail-diff против last segment перед Jaccard-отбросом
```

| Файл | Владелец |
|---|---|
| `src/lib/question-assembler.ts` | F2 |
| `src/hooks/useQuestionPipeline.ts` (только если нужны константы) | F2 read-mostly |

## F3 — промпт (R03, R13)

```ts
// src/lib/functions/ai-response.function.ts:328 — единый Promise.all
// Порог: h.score > 0.05 → h.score >= 0.45
```

| Файл | Владелец |
|---|---|
| `src/lib/functions/ai-response.function.ts` (блок ~328) | F3, после F1 |
| `src/lib/self-evolution-persist.ts` (синхронное чтение кэша) | F3 |

## F4 — ASR-слоты (R04, R06)

```ts
// src/lib/asr-discovery.ts — позитивный кэш base URL:
// export function resetAsrBaseUrlCache(): void — уже есть (инвалидация)
// WS-хуки: close on final, скип при mic IDLE
```

| Файл | Владелец |
|---|---|
| `src/lib/asr-discovery.ts` | F4 |
| `src/lib/asr-gate.ts` | F4 |
| `src/hooks/useThemWsStreaming.ts` | F4 |
| `src/hooks/useMicWsStreaming.ts` | F4 |

## F5 — Rust/VAD (R05, R07, R10)

```rust
// src-tauri/src/speaker/commands.rs:
// - кадры sr/8, пол шума только при !in_speech, envelope-follower
// src/hooks/useSystemAudioCapture.ts — safety 350мс (F4 НЕ трогает этот файл)
```

| Файл | Владелец |
|---|---|
| `src-tauri/src/speaker/commands.rs` | F5 |
| `src/hooks/useSystemAudioCapture.ts` (только safety-таймер) | F5 |

## F6 — фильтры (R08, R11, R12, R14)

| Файл | Владелец |
|---|---|
| `src/lib/asr-hallucinations.ts` | F6 |
| `src/lib/language-detect.ts` | F6 |
| `src/lib/speech-filter.ts` | F6 |
| `src/lib/vocab.ts` | F6 |
