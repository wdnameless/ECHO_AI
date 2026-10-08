# Scenario Profiles Program — границы и владельцы

## Slice 1 Profiles+Monologue (владелец: profiles worktree)
- `prompt-profiles.ts` расширяется: `flushGapMs, defaultLength, visibleButtons, monologue {mode, maxWindow}` + конструктор CRUD + экспорт/импорт.
- `useQuestionPipeline.ts` — реконфиг QuestionAssembler из профиля; сброс таймеров при смене.
- Монолог-буфер: копит сегменты в историю одним промптом; отправка авто/полуавто/вручную.
- Не трогает тулбар-кнопки (slice 2), провайдеры (slice 2), warmup/секреты (slice 3).

## Slice 2 Toolbar+Badge (владелец: toolbar worktree)
- `speech/index.tsx` — условный рендер групп по `visibleButtons` профиля; бейдж `activeProviderId/model` + dropdown быстрого переключения через `onSetSelectedAIProvider`.
- Экспорт `activeProviderId` из `useAIStreaming` → `useSystemAudio` → `SubtitleFeed`.
- Не трогает профили (slice 1), пайплайн (slice 3), код (slice 4).

## Slice 3 Latency (владелец: latency worktree)
- Warmup на старте сессии; кэш секрета в памяти; единая тишина (assembler подтверждает → manager не ждёт повторно); single-slot: явная очередь вместо backoff-гонки.
- Только точечные фиксы, архитектура ASR-потоков не меняется. Не трогает UI/профили.

## Slice 4 Livecode (владелец: livecode worktree)
- LLM-план вместо заглушки; толерантный парсер fences уже есть — расширить; Big-O + тест-кейсы в narration.
- Переиспользует code-answer chain. Не трогает профили/тулбар/скорость.
