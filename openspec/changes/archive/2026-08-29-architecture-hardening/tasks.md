# Tasks: architecture-hardening

> Сверено с кодом 2026-09-15. Изменение лежит в архиве, но закрыто не полностью:
> пункты 2, 6 и 8 не реализованы, пункт 4 закрыт лишь частично. Ниже отмечено
> фактическое состояние, а не исходное намерение.

## 1. Job Object (сайдкар умирает с Pluely) — ВЫПОЛНЕНО
- [x] 1.1 `handy_server.rs:210` — `assign_job_object`: `CreateJobObjectW` +
      `SetInformationJobObject(JobObjectExtendedLimitInformation)` с
      `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` + `AssignProcessToJobObject`
- [ ] 1.2 Верификация: `taskkill /F /IM pluely.exe` → pluely-asr умирает < 1 с — не запускалась
- [x] 1.3 Ручного `kill_sidecar()` в коде нет (Job Object покрывает graceful тоже)

## 2. Rust-таймеры эмиссии — НЕ ВЫПОЛНЕНО
- [ ] 2.1 WS-метод `{type:"config", emit_deadline_ms}` на сервере отсутствует
- [ ] 2.2 `questionFlushTimerRef` продолжает жить в `src/hooks/useQuestionPipeline.ts:36`
- [ ] 2.3 Тест «свёрнутое окно → эмиссия ≤ 300 мс» отсутствует
Примечание: JS-таймеры троттлятся в фоне, но частично компенсированы
`src/lib/timer-worker.ts` (Worker не троттлится), поэтому дефект не проявляется
как раньше. Задача формально не закрыта.

## 3. Микрофон через WS — ВЫПОЛНЕНО
- [x] 3.1 Микрофонные кадры уходят по WS (`src/hooks/useMicWsStreaming.ts`, `useMicCapture.tsx`)
- [x] 3.2 Открытие/закрытие потока зеркально системному (`useSystemAudio.ts`)
- [x] 3.3 Финал микрофона доходит до ленты и контекста
- [x] 3.4 Гарды на deaf-window не глушат собственный WS
- [x] 3.5 Батч-путь сохранён как фоллбек

## 4. Код-сплиттинг — ЧАСТИЧНО
- [x] 4.1 `vite.config.ts`: `manualChunks` для katex/mermaid/cytoscape/highlight/onnxruntime
- [ ] 4.2 Ленивой загрузки нет: `vendor-highlight` (9.3 МБ) и `vendor-mermaid` (2.2 МБ)
      попадают в стартовый граф через статические импорты
- [ ] 4.3 Метрика «стартовый JS < 1.5 МБ» не достигнута: `dist/assets/index-*.js` ≈ 1.96 МБ

## 5. Порт-дискавери — ВЫПОЛНЕНО
- [x] 5.1 Сайдкар пишет занятый порт в файл `asr-port`
- [x] 5.2 `src/lib/asr-discovery.ts` читает файл, фоллбек на 9877 и диапазон 9878–9882
- [x] 5.3 Константы порта обновлены (WS, fetch, health)

## 6. SQLite-персист Self-Evolution — НЕ ВЫПОЛНЕНО
- [ ] 6.1 Таблиц `se_exemplars`, `se_avoid_rules`, `se_custom_rules`, `se_feedback_log` в схеме нет
- [ ] 6.2 Миграции из localStorage нет
- [ ] 6.3 Self-Evolution продолжает жить в localStorage (`src/lib/self-evolution-persist.ts`)
- [ ] 6.4 Промпт-блок строится из localStorage, а не из SQLite

## 7. Error surface — ВЫПОЛНЕНО
- [x] 7.1 Ошибка пайплайна доезжает до ленты (`pipelineError` в `SubtitleFeed.tsx`, `ResultsSection.tsx`)
- [x] 7.2 Отображение в футере ленты с текстом ошибки

## 8. Третья сессия — НЕ ВЫПОЛНЕНО (опционально)
- [ ] 8.1 Третьей сессии в `handy_server.rs` нет
- [ ] 8.2 Нагрузочный тест 2 WS + 3 batch не проводился
