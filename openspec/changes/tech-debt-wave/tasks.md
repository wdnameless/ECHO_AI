# Tasks: Tech-debt wave

Интеграция: `feat/tech-debt-integration`. Каждый слайс — worktree + ветка +
свой oracle. Порядок: S7 → (S1+S5) → S2 → S6 → S4 → S3.

## S7 — Clippy ноль (первый, дешёвый)
Ветка: `fix/s7-clippy` · Worktree: `../Pluely-s7-clippy`
- [ ] T7.1 transmute-аннотации memory/mod.rs + dead StorageItem::new + Result<_,()> (fixer)
- [ ] T7.2 oracle слайса (cargo clippy 0 warning)

## S1 — Распил ленты
Ветка: `refactor/s1-feed-split` · Worktree: `../Pluely-s1-feed`
- [ ] T1.1 FeedRow/AICard/Popovers/RulePreview + переезд тестов (fixer)
- [ ] T1.2 oracle слайса (рендер 1:1, сьют green)

## S5 — Промпт-билдер
Ветка: `refactor/s5-prompt-builder` · Worktree: `../Pluely-s5-prompt`
- [ ] T5.1 prompt-builder.ts (чистая функция) + превью на нём + тесты (fixer)
- [ ] T5.2 oracle слайса (байт-стабильность промптов)

## S2 — Zustand
Ветка: `refactor/s2-zustand` · Worktree: `../Pluely-s2-zustand`
- [ ] T2.1 сторы профили/аудио/стелс/история + миграция потребителей (fixer)
- [ ] T2.2 oracle слайса (ререндеры, сьют green)

## S6 — Распил аудио-хука
Ветка: `refactor/s6-audio-split` · Worktree: `../Pluely-s6-audio`
- [ ] T6.1 захват/транскрибация/восстановление + тесты (fixer)
- [ ] T6.2 oracle слайса

## S4 — SQL-мост
Ветка: `feat/s4-sql-bridge` · Worktree: `../Pluely-s4-sql`
- [ ] T4.1 tauri-команды на все запросы + убрать allow-execute (fixer)
- [ ] T4.2 oracle слайса

## S3 — Нативный WS (последний, рискованный)
Ветка: `feat/s3-native-ws` · Worktree: `../Pluely-s3-ws`
- [ ] T3.1 Rust WS-клиент + редизайн asr-gate + тесты (fixer)
- [ ] T3.2 oracle слайса + финальный интеграционный oracle
