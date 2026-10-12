# Interfaces: filler-style-coaching

## Рендер (владелец: src/components/Markdown/renderer.tsx)
- `remarkPlugins={[remarkMath]}` в `Streamdown` (зависимость уже в lockfile через тест — перенести в deps при необходимости).
- Комментарий «remarkPlugins не трогаем: gfm/math…» — удалить/исправить (врал).
- Тест: рендер строки с `$$15$$` → в DOM нет текстового `$$`, есть `.katex`.

## Фильтр (владелец: src/lib/filler-filter.ts)
- `DEFAULT_FILLER_FILTER_CONFIG.filterAiEnabled = false`.
- Миграция: у кого ключ уже записан — уважаем запись; меняем только дефолт для новых.
- Существующие тесты дефолта обновить (было `true` → `false`).

## Стиль юзера (владелец: src/lib/storage/user-facts.ts + новый src/lib/speech-style.ts)
- `export interface SpeechStyle { fillers: Array<{word: string; count: number}> }`
- `export function extractSpeechStyle(transcripts: string[]): SpeechStyle` — чистая функция: считает филлеры из `ALL_DEFAULT_FILLERS` + растянутые (`isStretchedFiller`-подобная эвристика), топ-8.
- `buildSelfEvolutionPromptBlock` добавляет секцию «Речевые маркеры пользователя» при включённом обучении, кап: не более 3 маркеров в ответе (инструкция модели, не пост-обработка).
- Вызов: `addInteraction(source=me)` складывает сырой текст в журнал речи (отдельный ключ, не feedback log).

## Коучинг (владелец: SubtitleFeed + user-facts.ts)
- Кнопка на реплике `them`: `onTakeAsRule(entryId, text)` → `addUserRule(text, {source:"coach"})`.
- `export function addUserRule(rule: string, opts?: {source}): void` — в `customRules` + journal entry `topic=coach`.
- Журнал и редактор показывают бейдж источника (coach/manual/feedback).

## Замер (владелец: scripts/ + metrics.ts)
- Живая сессия: прогнать мок-диалог, снять `lastPartialMs/avgPartialMs`, `lastFirstTextMs`, `lastTtftMs/avgTtftMs`, ASR-финал, flushGap профиля.
- Отчёт: таблица вкладов + вывод «главное узкое место». Лежит в `openspec/changes/filler-style-coaching/perf-notes.md`.
