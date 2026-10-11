# Interfaces: trust-fixed one-button self-learning

Контракт: один `LearningProfile`, один тумблер, SQLite — истина,
localStorage — синхронный кэш. Потребители не трогают хранилища
напрямую.

## Владелец состояния (src/lib/storage/user-facts.ts)
- `export interface LearningProfile { facts: UserFact[]; style: UserStylePreference; rules: string[] }` — единственный тип профиля.
- `export function isSelfLearningEnabled(): boolean` — читает `SELF_LEARNING_ENABLED` (default: true, чтобы текущие юзеры не потеряли поведение молча? НЕТ: default false до первой явной кнопки? Решение: default **true**, т.к. R05 «кнопка» подразумевает переключение существующего поведения, а не opt-in с нуля; фиксируем здесь).
- `export function setSelfLearningEnabled(on: boolean): void`
- `getUserFacts(): UserFact[]` — пусто = `[]`. `DEFAULT_FACTS` удаляется из промпт-пути (константа может остаться как примеры для пустого UI, но НЕ инжектится).
- `recordFeedback(...)` — первым делом `if (!isSelfLearningEnabled()) return entry-noop` (не пишет никуда). Иначе как сейчас + SQLite mirror.
- `buildSelfEvolutionPromptBlock()` — возвращает `""` при выключенной кнопке. При включённой — только реальные факты/стиль; языкового правила внутри НЕТ.
- `export const LANGUAGE_RULE = "..."` — RU/EN правило, применяется всегда.
- `resetLearning(): Promise<void>` — чистит localStorage И SQLite (`DELETE FROM se_style/se_feedback_log` + сброс строки 1).

## Источник правды (src/lib/self-evolution-persist.ts)
- `mirrorStyle/mirrorFeedback` — без изменений (fire-and-forget).
- `restoreSelfEvolution()` — вызывается один раз при старте приложения (владелец вызова: App bootstrap). Удаляет мёртвость.
- `getStyleFromDbOrCache()` — вызывается из `buildEnhancedSystemPrompt` через `setSelfEvolutionStyleOverride(await ...)` ПЕРЕД `buildSelfEvolutionPromptBlock()`. Таймаут 400мс уже внутри.
- Инвариант: SQLite — истина; localStorage — производное. Тест: сброс → оба пустые; рестарт с пустым кэшем → восстановление из SQLite.

## Применение (владелец: ai-response.function.ts)
- `buildEnhancedSystemPrompt`: `prompts.push(LANGUAGE_RULE)` всегда; evolution block только если `isSelfLearningEnabled()`, со стилем из DB-or-cache.
- Пути интервью/беседа/лайвкод/чаты идут через эту функцию — отдельного гейта на каждый путь не нужно (одна точка).

## Запись сигналов (владелец: SubtitleFeed)
- Кнопки 👍/👎 и причины — без изменений UI; при выключенной кнопке дают тост «Самообучение выключено» и не зовут `recordFeedback`.
- `questionContextFor` — без изменений.

## Кнопка + редактор (владелец: PromptProfilesSettings + SubtitleFeed popover)
- Тумблер `Switch checked=isSelfLearningEnabled()`: один и тот же компонент в настройках и в 🧠-поповере (переиспользование, не два источника).
- Редактор фактов/правил: существующие `facts`/`stylePrefs` + удаление по id; журнал: `getFeedbackLog()` последние 20 с вопросом/ответом/причиной. Каждая правка в редакторе — сигнал обучения (`source=manual`), видна в журнале. Inline-правки ответов в ленте и правки ASR-словаря сигналами НЕ являются.
- Сброс: зовёт `resetLearning()` (оба хранилища), обновляет UI из пустого состояния.

## Профиль SELF_EVOLUTION (владелец: prompt-profiles.ts)
- Профиль остаётся сценарием-подсказкой, НЕ тумблером обучения. Описание правится: «стиль + факты применяются кнопкой, независимо от профиля».

## Эталоны (владелец: scripts/self-learning-goldens.* + vitest)
- Фиксированные кейсы: `{вопрос, фидбек, вопрос2, ожидание}` — проверка: признак адаптации есть в промпт-блоке (не в живом LLM-ответе: детерминировано).
- Минимум 6 кейсов: тон, длина, списки, вводные слова, факт о стеке, запрет выдуманных фактов.
- DRY: эталоны читаются и скриптом демо, и vitest (один файл данных).
