# CONTEXT.md — Thought-trace + Livecoding program

Ubiquitous language (Wave 0 + Wave 1 recon):

| Term | Meaning | Code anchor |
|---|---|---|
| Ход мыслей (thought-trace) | Компактное обоснование поверх ответа: почему так, на что опирался | `buildEnhancedSystemPrompt` + новый thought-блок |
| Лайвкодинг | Голосовой режим: задача → диктуемый код с устным объяснением | `triggerCodeAnswer`, `buildCodePlan/Full` |
| Режим ответа | Тумблер interview/thought/livecode в тулбаре | `speech/index.tsx` + store по образцу `answer-length-override.ts` |
| Вопрос | Собранная из ASR-сегментов реплика собеседника | `question-assembler.ts` |
| Промпт | Слоёная инструкция: база + длина + humanizer + RAG + факты | `ai-response.function.ts:200` |
| Лента | Поток субтитров с ответами и кодом | `SubtitleFeed.tsx` |

Decisions: thought_shape=Компактный; thought_place=В той же ленте; live_scope=Только голос; audit_depth=Полный разбор.
Blockers R01: humanizer/35-55 cap, max_tokens=600, reasoning minimal, нет thought-контейнера.
Blockers R02: нет persistent toggle, auto-ask bypass, humanizer в code-промпте, статичный plan-fallback, парсер требует закрывающих бэктиков.
