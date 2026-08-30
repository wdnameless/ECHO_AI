# Tasks: architecture-hardening

## 1. Job Object (сайдкар умирает с Pluely)
- [ ] 1.1 `src-tauri/src/lib.rs`: после spawn_pluely_asr получить HANDLE дочернего
      процесса, `CreateJobObjectW` + `SetInformationJobObject(JobObjectExtendedLimitInformation
      с JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)` + `AssignProcessToJobObject`
- [ ] 1.2 Верификация: `taskkill /F /IM pluely.exe` → pluely-asr умирает < 1 с
- [ ] 1.3 Убрать ручной `kill_sidecar()` (Job Object покрывает graceful тоже)

## 2. Rust-таймеры эмиссии
- [ ] 2.1 Новый WS-метод `{type:"config", emit_deadline_ms}` — сервер сам держит
      дедлайн эмиссии и шлёт финал без JS-таймеров
- [ ] 2.2 FE: убрать questionFlushTimerRef setTimeout, полагаться на сервер
- [ ] 2.3 Тест: свёрнутое окно → эмиссия ≤ 300 мс после последнего кадра

## 3. Микрофон через WS
- [ ] 3.1 useMicCapture: ScriptProcessor → emit "mic-frame" (b64 f32 16k) каждые 250 мс
- [ ] 3.2 useSystemAudio: openMicStream/closeMicStream зеркально them-WS
- [ ] 3.3 Финал микрофона через finalize (пропуская батч) → recordContextMessage
- [ ] 3.4 Гарды: deaf window не должен глушить собственный WS (это свой голос)
- [ ] 3.5 Фоллбек: WS недоступен → прежний батч-путь

## 4. Код-сплиттинг
- [ ] 4.1 vite.config: manualChunks для katex/mermaid/cytoscape/highlight/onnxruntime
- [ ] 4.2 Ленивая загрузка в компонентах, где они реально используются
- [ ] 4.3 Метрика: стартовый JS < 1.5 МБ

## 5. Порт-дискавери
- [ ] 5.1 Сервис: --port 0 → авто-выбор свободного, писать порт в %APPDATA%/pluely/asr-port
- [ ] 5.2 FE: читать порт из файла, фоллбек на 9877
- [ ] 5.3 Обновить все константы (ws url, fetch, health)

## 6. SQLite-персист Self-Evolution
- [ ] 6.1 Схема: se_exemplars, se_avoid_rules, se_custom_rules, se_feedback_log
- [ ] 6.2 Идемпотентная миграция из localStorage при первом запуске
- [ ] 6.3 getSelfEvolutionStats/recordFeedback → SQL
- [ ] 6.4 Промпт-блок строится из SQLite

## 7. Error surface
- [ ] 7.1 lastPipelineError state (source, message, ts)
- [ ] 7.2 Отображение в футере ленты (красная точка + текст, тап для деталей)

## 8. Третья сессия (опционально)
- [ ] 8.1 state.rs: третья сессия для двусторонних одновременных стримов
- [ ] 8.2 Нагрузочный тест: 2 WS + 3 batch — все 200