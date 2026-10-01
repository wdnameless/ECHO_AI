# Interfaces: P4 фолбэк-цепочка провайдеров

## Цепочка (владелец: ai-response.function.ts)
- `fetchAIResponse(params + allProviders?: TYPE_PROVIDER[])`.
- Без `allProviders` — ровно один кандидат, старое поведение (ранний return).
- С `allProviders`: кандидаты = `[params.provider, ...allProviders без того же id]`
  (дедуп через `seenIds`). PluelyAPI-ветка (`shouldUsePluelyAPI`) вне цепочки —
  возвращается раньше, как раньше.
- Внутренний ретрай 502/503/429/530 (500мс) остаётся ВНУТРИ кандидата.

## Детектор сбоя (владелец: ai-response.function.ts)
- `isFailureChunk(chunk: string): boolean` — failure-чанки вместо throw:
  сеть, HTTP (`API request failed`, `HTTP NNN`), парс, trust-отказ
  (`Запрос отменён`), STALL (`Провайдер не ответил`), пустые образы,
  ненастроенный ключ/переменные, `does not support image input`.
- Частичный успех побеждает: хоть один реальный чанк — ответ принят,
  фолбэка нет (`yieldedRealContent`).
- Аборт (`signal.aborted` / `AbortError`) — тихий return, не фолбэк, не throw.

## Переключение (стрим, владелец: useAIStreaming / useCompletionCommon)
- Маркер `(переключаю на <nextId>…)` в стрим (R03, виден кандидату).
- Накопление чистое: новый кандидат не наследует обрывки.
- Исчерпание: `throw Все провайдеры недоступны (пробовали: A, B): <last>`.

## Проводка (владельцы: хуки)
- `useAIStreaming.processWithAI` → `allProviders: allAiProviders` (L165).
- `StreamAIResponseOptions.allProviders?` → сквозной passthrough (L646).
- `useChatCompletion` (L138), `useCompletion` (L173) — передают свой список.
