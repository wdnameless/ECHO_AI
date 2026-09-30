# Interfaces: границы и владельцы

## `useSpeechModelSwitch` (модели, владелец: audio)
- `lang: "ru" | "en"`, `switching: bool`, `switchTo(next): { ok, missingModel? }`.
- RU → `Voxtral-Mini-4B-Realtime-2602` + `setAsrLanguage("ru")`; EN →
  `parakeet-unified-en-0.6b` + `setAsrLanguage("en")`. `selectModel` рестартит
  движок и сбрасывает оба ASR-кэша сам.
- Без файла на диске: `{ ok: false, missingModel }` → UI показывает «Скачать
  в Моделях», не качает сам. Лок `switching` против двойных кликов.
- Панель: сегмент RU/EN рядом с Авто/Вручную; состояние в `useSystemAudio`
  (`speechModelLang/Switching/onSpeechModelSwitch`), localStorage
  `speech_model_lang` (дефолт `ru`).

## `answer-length` + override (длина, владелец: AI)
- `resolveAnswerLength(q, toolbar)`: префикс (`кратко:/подробно:` + EN) >
  тулбар (`auto|short|long`) > `isLongQuestion` (маркеры + `?`>60 + длина>140).
- `splitLengthPrefix` чистит префикс из вопроса до отправки.
- `SHORT_LENGTH_PROMPT` (35–55) / `LONG_LENGTH_PROMPT` (~140, монолог без
  списков). `INTERVIEW_MODE_INSTRUCTIONS` — без зашитого капа (regex-замена
  KEEP CONCISE на ссылку на ANSWER-LENGTH).
- Тулбар: Авто/Кратко/Подробно; `answer-length-override.ts` (localStorage
  `answer_length_override`).

## Filler-stitch (перебивки, владелец: AI)
- `getActiveFiller()` снапшот в `useAIStreaming` (ref из `useSystemAudio`,
  читается на первом чанке). Сшивка `filler + "\n\n"` в `fullResponse` И в
  `streamBufferRef` (иначе первый flush её теряет — второй найденный баг).
- `clearFiller()` остаётся везде (состояние), тело ответа нетронуто.
- Баннер «Заполните паузу» — только пока `lastAIResponse` пуст.

## Openers (разнообразие, владелец: AI)
- `ANSWER_OPENERS_RU/EN` 12+12 в `humanizer.rules.ts`, `pickAnswerOpener(lang)`
  без повтора подряд (`lastOpenerRef`), `""` = без захода.
- Промпт: `Open with exactly this phrase: "..."` вместо 3 захардкоженных
  примеров. `HUMANIZER_INSTRUCTIONS` — про ротацию, не примеры.
