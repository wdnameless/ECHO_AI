# Tasks — perf-latency-wave

## Fixer-A (Rust zone)
- [ ] A1. Adaptive noise-floor VAD (⚠️ код есть, но silence default 12, не 10 — решение: оставить 12)
- [x] A2. `speech-frame` payload → base64 string (C1, R03)
- [ ] ~~A3. `warm_llm_connection(url)` command~~ STALE: удалён в audit-recovery-hardening, покрыт useWarmup-хуком
- [x] A4. `db::main::apply_pragmas` (WAL/NORMAL/MEMORY/cache) called from `lib.rs::run()` (C5, R06)
- [ ] A5. `cargo test --lib` зелёный (47+) — чеклист эпохи, сьют давно шире

## Fixer-B (TS zone)
- [x] B1. `speech-frame` listener: base64 decode → ArrayBuffer (C1)
- [x] B2. Stable system-prompt order: static prefix / volatile tail (C3, R02)
- [x] B3. Gap timers: fast preset 800→550 / early 500→400; re-arm 2x→1.4x (C7, R01)
- [ ] ~~B4. Streaming translation debounce 400ms~~ STALE: superseded — partials пропускаются в useTranslationQueue
- [ ] ~~B5. `warm_llm_connection` fire-and-forget~~ STALE: см. A3
- [ ] B6. `npx tsc --noEmit` чистый; `npm test` зелёный (304+) — чеклист эпохи

## Orchestrator
- [ ] O1–O4: чеклист релиза эпохи (не выполнялся как единица; покрыто позднейшими релизами)
