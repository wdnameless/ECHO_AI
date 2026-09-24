# Tasks — perf-latency-wave

## Fixer-A (Rust zone)
- [ ] A1. Adaptive noise-floor VAD in `run_vad_capture` (R01): rolling min-RMS floor, dynamic threshold, `silence_chunks` default 15→10
- [ ] A2. `speech-frame` payload → base64 string (C1, R03)
- [ ] A3. `warm_llm_connection(url)` command + register in `lib.rs` (C2, R04)
- [ ] A4. `db::main::apply_pragmas` (WAL/NORMAL/MEMORY/cache) called from `lib.rs::run()` (C5, R06)
- [ ] A5. `cargo test --lib` зелёный (47+)

## Fixer-B (TS zone)
- [ ] B1. `speech-frame` listener: base64 decode → ArrayBuffer (C1)
- [ ] B2. Stable system-prompt order: static prefix / volatile tail (C3, R02)
- [ ] B3. Gap timers: fast preset 800→550 / early 500→400; re-arm 2x→1.4x (C7, R01)
- [ ] B4. Streaming translation debounce 400ms for partial entries (C6, R05)
- [ ] B5. `warm_llm_connection` fire-and-forget call inside `arm()` when provider URL known (C2, R04)
- [ ] B6. `npx tsc --noEmit` чистый; `npm test` зелёный (304+)

## Orchestrator
- [ ] O1. Full suite (vitest + cargo test) после интеграции
- [ ] O2. `npx tauri build --no-bundle`; deploy в `D:\echo-ai-portable`; запуск; проверка окна
- [ ] O3. Oracle blind acceptance vs manifest
- [ ] O4. Commit + push + tag
