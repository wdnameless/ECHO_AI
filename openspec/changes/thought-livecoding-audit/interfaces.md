# Thought-trace + Livecoding — границы и владельцы

## AnswerMode store (общий контракт, владелец: ThoughtSlice)
- `src/lib/answer-mode.ts` (новый, по образцу `answer-length-override.ts`): `getAnswerMode(): "interview" | "thought" | "livecode"`, `setAnswerMode()`. localStorage, синхронный, без контекста.
- Тумблеры в `speech/index.tsx` читают/пишут только этот стор. `useIsPortable`-аналогов нет — источник один.

## ThoughtSlice (владелец: thought-trace worktree)
- `useAIStreaming.ts: triggerAIForQuestion` — ветка thought: thought-блок в промпт, bypass humanizer-капа и SHORT_LENGTH, reasoning не minimal.
- `ai-response.function.ts: buildEnhancedSystemPrompt(mode)` — принимает режим, thought-блок после базы, humanizer/opener пропускаются в thought-режиме.
- `SubtitleFeed.tsx` — thought-контейнер в той же ленте. Не трогает code-парсер.

## LivecodeSlice (владелец: livecoding worktree)
- `useAIStreaming.ts: triggerCodeAnswer` + `auto-ask.ts` — persistent toggle ведёт в code-промпт без ручных кликов.
- `code-answer.ts` — plan-fallback через LLM вместо статики; `splitCodeAnswer` терпит незакрытые бэктики.
- Переиспользует `buildCodePlan/Full`, `matchCodeTemplate`, `findCodeRequestInHistory`. Не дублирует.

## AuditSlice (владелец: audit worktree, read-only + фиксы блокеров)
- Отчёт `openspec/changes/thought-livecoding-audit/audit.md`. Фиксит только апстрим-баги режимов (история, филлер, abort).
- Не пишет UI/промпты режимов. Не трогает RU/EN recognition (отдельный баг, вне скоупа).
