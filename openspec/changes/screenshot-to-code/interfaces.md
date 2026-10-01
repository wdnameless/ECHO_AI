# Interfaces: P3 скриншот → код

## Кнопка (UI, владелец: speech/index.tsx)
- «Код со скрина» в код-ряду рядом с План/Код; те же disabled (isAIProcessing,
  нет реплики). Вызов: `answerCodeForLastUtterance("full", { screenshot: true })`.

## Захват (вход, владелец: useSystemAudio)
- `answerCodeForLastUtterance(stage, opts?)`: при `opts.screenshot` —
  `invoke("capture_to_base64")` → `pendingScreenshotRef` + `setPendingScreenshot`;
  провал захвата = ранний return (нет скрина — нет ответа, не вслепую).
- Вопрос — из `findCodeRequestInHistory` (как План/Код), скрин — свежий.

## Модельный путь (стриминг, владелец: useAIStreaming)
- `triggerCodeAnswer`: скриншот форсит модель (`full.text && !hasScreenshot`
  — ранний возврат только без скрина). `buildCodeSystemPrompt(q, withScreenshot)`
  добавляет vision-правило (прочитай → разбор → fence с табами → нарратив).
- `processWithAI` уже несёт `imagesBase64` в провайдера; vision без поддержки
  у модели — ошибка провайдера, не тишина.

## Рендер (UI, владелец: SubtitleFeed)
- Тот же `splitCodeAnswer`/`CodeAnswerBody`: fence, табы (tabSize 4),
  кнопка «Код» копирует сниппет. Проза — нарратив для проговаривания.
