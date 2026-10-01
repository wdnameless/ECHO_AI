# Interfaces: P5 ручной разбор при STALL

## Сентинел (владелец: ai-response.function.ts)
- `export const STALL_SENTINEL = "__ECHO_STALL__"` (:385).
- STALL catch: `yield STALL_SENTINEL; useUnboundedRead = true; continue`
  (:792-796) — дальше голый `reader.read()` без таймаута, `cancel` нет.
- `isFailureChunk` сентинел исключает (:874); P4 форвардит без фолбэка
  (:1014-1017: `yield chunk`, цепочка не дёргается, исчерпания нет).
- Оба потребителя фильтруют: `useAIStreaming` (:199-202, `continue` без
  append), `useCompletionCommon` (`continue` до `fullResponse += chunk`).

## Состояние и действия (владелец: useAIStreaming)
- `isStalled: boolean` + `lastRequestRef {transcription, prompt,
  previousMessages, imagesBase64, source}`.
- `stallWait()` — снять баннер, стрим и так ждёт.
- `stallRetry()` — тот же провайдер заново тем же запросом.
- `stallNext()` — one-off следующий из `allAiProviders` (глобальный выбор
  НЕ меняется). `stallNextId` — имя для баннера.
- Возврат: `{ isStalled, stallWait, stallRetry, stallNext, stallNextId }`.
- Проброс: `useSystemAudio` → `speech/index.tsx` → `ResultsSection`
  → `SubtitleFeed`.

## Баннер (владелец: SubtitleFeed)
- Пропсы: `{ isStalled?, stallNextId?, onStallWait?, onStallRetry?,
  onStallNext?, onOpenProviders? }`.
- Тихий ряд кнопок Ждать/Повторить/Другой виден СРАЗУ при обработке
  (пустой ответ); на STALL — prominent amber + счётчик секунд тишины.
- «Другой»: клик = `onStallNext` (one-off); рядом ссылка = `onOpenProviders`
  → `CustomEvent("open-providers")`, слушает панель провайдеров.

## Тишина (R04)
- Ни авто-повтора, ни авто-сдачи. Аборт (стоп/новый вопрос/unmount)
  закрывает зависший стрим (`signal` + `reader.cancel` живы).
