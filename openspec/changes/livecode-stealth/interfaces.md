# Interfaces: границы и владельцы

## `src/lib/code-templates.ts` (знания, владелец: livecode)
- `CODE_TEMPLATES: CodeTemplate[]` — 12 шаблонов (id/keywords/plan/snippet/narration).
- `matchCodeTemplate(question): CodeTemplate | null` — keyword-hit, first wins.
- Добавление шаблона = +1 запись, без кода.

## `src/lib/code-answer.ts` (режим, владелец: livecode)
- `buildCodePlan(q): CodeAnswer` — мгновенно, без модели.
- `buildCodeFull(q): CodeAnswer` — текст готов при match, `""` = стримить модель.
- `buildCodeSystemPrompt(q): { prompt, template }` — plain code-промпт, humanizer
  подавлен; при match — snippet как reference.
- `CodeAnswer { stage, text, template }` — контракт со стримингом.

## `useAIStreaming.triggerCodeAnswer(q, stage, source)` (стриминг, владелец: AI)
- Обходит filler/cooldown guards (ручной вызов — не backchannel).
- plan/full с match — без `processWithAI`; full без match — через него.
- Генерация/аборт/флаги — общие с обычным путём (один `generationRef`).

## `useSystemAudio.answerCodeForLastUtterance(stage)` (вход, владелец: audio)
- Тот же `resolveFreshestInterviewerText`, что у spoken "Ответить".
- Слушатели: `code-mode-trigger` (кнопка бара) + `code_mode` хоткей через
  `useSystemAudioKeyboard.onCodePlan`. Панель: кнопки План/Код.
- Возвращает в `return` хука рядом с `answerLastInterviewerUtterance`.

## Стелс (владелец: overlay)
- Слайдер `input[type=range]` 20–100 в баре → `onSetTransparency(100-v)`,
  clamp 0–80 в `theme.context`; `--opacity` дотянут до `.panel-docked`.
- Босс-кей `toggle_window` (ctrl+backslash): фикс `setIsHidden(payload)`
  вместо инверсии; Esc-хайд в баре с уступкой инпутам.
- Новый хоткей `code_mode` (ctrl+shift+k) регистрируется через существующий
  custom-shortcut канал (merge с дефолтами, без миграций).
