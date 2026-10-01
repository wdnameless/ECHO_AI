# Interfaces: P0 прогрев

## `useWarmup` (оркестратор, владелец: audio)
- `useWarmup({ providerUrl, modelKey })` → `{ state, visible, warm, doneAt }`.
- `warm()` шаги: `start_handy_server` → `handy_server_status_detailed` (онлайн),
  `warm_llm_connection(providerUrl)` (сокет), `getRagContext`×2 (кэш).
  Готово = engineOnline && (providerUrl ? providerWarmed : true).
- `visible`: idle/running/failed ИЛИ модель сменилась (`lastModelKey !== modelKey`).
  После успеха — скрыта; смена модели возвращает.
- Экспорт через `useSystemAudio`: `warmupState/warmupVisible/onWarmup`.

## Кнопка (UI, владелец: speech/index.tsx)
- Рядом с RU/EN; idle = «Прогреть», running = спиннер «Готовится», done = скрыта,
  failed = «Прогреть» снова (можно повторить).
- Никогда не греет тихо: скрытая кнопка, которая полу-грелась, хуже видимой.

## Провайдер (связь, владелец: AI)
- `resolveActiveProviderUrl` экспортирован из `useQuestionPipeline` (был
  приватным) — warmup зовёт его раньше первого вопроса; `warm_llm_connection`
  в api.rs принимает только https + хост с точкой (валидация уже была).

## RAG (контекст, владелец: AI)
- `getRagContext` читает и кэширует 30с. Прогрев покупает DB-read; TTL короткий
  намеренно (контекст редактируется) — прогретый кэш устаревает к вопросу, и это
  честно: мы покупаем старт БД, не бессмертный кэш.

## Метрика приёмки
- TTFT первого ответа ≤ второго (metrics.ts `lastTtftMs`/`avgTtftMs` уже есть).
