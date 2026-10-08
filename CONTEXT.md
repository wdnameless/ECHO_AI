# CONTEXT.md — Thought-trace + Livecoding program

Ubiquitous language (Wave 0 + Wave 1 recon):

| Term | Meaning | Code anchor |
|---|---|---|
| Ход мыслей (thought-trace) | Компактное обоснование поверх ответа: почему так, на что опирался | `buildEnhancedSystemPrompt` + новый thought-блок |
| Лайвкодинг | Голосовой режим: задача → диктуемый код с устным объяснением | `triggerCodeAnswer`, `buildCodePlan/Full` |
| AnswerMode | `"interview" \| "thought" \| "livecode"` — единый стор режима ответа | `src/lib/answer-mode.ts:3` |
| AutoAskTarget | `"interview" \| "code"` — цель автораспределения вопроса | `src/lib/auto-ask.ts:7` |
| SplitCodeResult | `{ code, lang, prose }` — результат парсинга fences | `src/lib/code-answer.ts:123` |
| ThoughtContainer | Янтарный блок обоснования поверх ответа в ленте | `SubtitleFeed.tsx:239` |
| Вопрос | Собранная из ASR-сегментов реплика собеседника | `question-assembler.ts` |
| Промпт | Слоёная инструкция: база + длина + humanizer + RAG + факты | `ai-response.function.ts:200` |
| Лента | Поток субтитров с ответами и кодом | `SubtitleFeed.tsx` |
| Сценарий | Профиль Собес/Беседа/Лайвкод: flushGap, промпт, длина, видимые кнопки | `prompt-profiles.ts` + `ScenarioProfileExtensions` |
| Монолог-буфер | Накопленный нон-стоп спич одним промптом в историю | `QuestionAssembler` + `AutoAskManager` |
| Бейдж модели | Активная модель/провайдер в оверлее + быстрое переключение | `activeProviderId` → `SubtitleFeed` |
| Turn-gate | «Ждёт продолжения» + «ответить всё равно» при незавершённой реплике | `useQuestionPipeline` |
| SlotQueueRequest | `{ owner, callback }` — явная FIFO-очередь single-slot ASR | `src/lib/asr-gate.ts:22` |

Decisions: thought_shape=Компактный; thought_place=В той же ленте; live_scope=Только голос; audit_depth=Полный разбор.
Blockers R01: humanizer/35-55 cap, max_tokens=600, reasoning minimal, нет thought-контейнера.
Blockers R02: нет persistent toggle, auto-ask bypass, humanizer в code-промпте, статичный plan-fallback, парсер требует закрывающих бэктиков.
