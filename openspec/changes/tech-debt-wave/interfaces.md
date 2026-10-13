# Interfaces — Tech-debt wave (S1–S7)

Поведение 1:1; публичные пропсы/хуки потребителей не меняются без Expand–Contract.

## S1 — feed split

```
src/pages/app/components/speech/feed/
  FeedRow.tsx      — строка me/them (копирование, правки, перевод)
  AICard.tsx       — карточка ответа ИИ (лайки, углубление)
  FeedPopovers.tsx — Self-Evolution + предложения поведения
  RulePreview.tsx  — превью правила (переезд из SubtitleFeed)
SubtitleFeed.tsx   — тонкая сборка + экспорт имён (совместимость тестов)
```

| Файл | Владелец |
|---|---|
| `src/pages/app/components/speech/feed/*` | S1 |
| `src/pages/app/components/speech/SubtitleFeed.tsx` | S1 |

## S2 — zustand

```ts
// src/stores/*.ts (новые, zustand — согласованная зависимость)
useProfilesStore, useAudioStore, useStealthStore, useHistoryStore
// app.context.tsx — тонкие фасады поверх сторов на время миграции, затем удаление
```

| Файл | Владелец |
|---|---|
| `src/stores/*` | S2 |
| `src/contexts/app.context.tsx` | S2 |
| `package.json` (+zustand) | S2 |

## S3 — native WS

```rust
// src-tauri/src/asr_stream.rs (новый): tokio-tungstenite клиент к sidecar
// команды: asr_native_connect / asr_native_send / asr_native_close
// src/lib/asr-gate.ts — владелец стрима виден Rust, не JS
```

| Файл | Владелец |
|---|---|
| `src-tauri/src/asr_stream.rs` | S3 |
| `src/lib/asr-gate.ts` | S3 |
| WS-хуки (тонкая адаптация) | S3 |

## S4 — SQL bridge

```rust
// src-tauri/src/db/commands.rs: typed команды на каждый запрос фронта
// tauri.conf.json: убрать sql:allow-execute
```

| Файл | Владелец |
|---|---|
| `src-tauri/src/db/commands.rs` | S4 |
| `src/lib/database/*` (вызовы через invoke) | S4 |

## S5 — prompt builder

```ts
// src/lib/prompt-builder.ts (новый): чистая сборка промпта из контекста
export function buildPrompt(ctx: PromptContext): string;
// ai-response.function.ts вызывает; ProfileEditor.preview — тот же билдер
```

| Файл | Владелец |
|---|---|
| `src/lib/prompt-builder.ts` | S5 |
| `src/lib/functions/ai-response.function.ts` | S5 |

## S6 — audio split

```
src/hooks/audio/
  useCapture.ts      — захват устройства/уровни
  useTranscribe.ts   — WS/batching/фолбэки
  useRecovery.ts     — таймеры восстановления/метрики
useSystemAudioCapture.ts — сборка (совместимость)
```

| Файл | Владелец |
|---|---|
| `src/hooks/audio/*` | S6 |
| `src/hooks/useSystemAudioCapture.ts` | S6 |

## S7 — clippy

| Файл | Владелец |
|---|---|
| `src-tauri/src/memory/mod.rs` (transmute) | S7 |
| `src-tauri/src/activate.rs` (dead new) | S7 |
| `src-tauri/src/portable_update.rs` (Result) | S7 |
