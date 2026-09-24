# Interfaces — perf-latency-wave

## Cross-zone contracts (fixed before spawn)

### C1. `speech-frame` event payload (Rust → JS)
- WAS: `Vec<u8>` → JSON `number[]` (~60-80KB на фрейм).
- СТАЛО: base64 `String` (~22KB). Имя события не меняется.
- Rust emitter: `src-tauri/src/speaker/commands.rs` (owner: Fixer-A).
- JS consumer: `src/hooks/useSystemAudioCapture.ts` (`listen<string>("speech-frame", …)` → декод base64 → `ArrayBuffer`) (owner: Fixer-B).

### C2. `warm_llm_connection` Tauri command (JS → Rust)
```rust
#[tauri::command]
pub async fn warm_llm_connection(url: String) -> Result<(), String>
```
- Объявление: `src-tauri/src/api.rs` (owner: Fixer-A); регистрация в `invoke_handler` в `lib.rs`.
- Вызов: `src/hooks/useQuestionPipeline.ts` внутри `arm()` (fire-and-forget, только если известен URL провайдера; URL берётся из curl-шаблона активного провайдера через существующий хелпер) (owner: Fixer-B).
- Поведение Rust: shared `reqwest::Client` HEAD/GET с таймаутом 1.5с, результат игнорируется (побочный эффект — TLS-сеанс в пуле).

### C3. System prompt block order (byte-stable prefix)
Статичный префикс (байт-идентичен между запросами): base prompt → conversational filter rule → markdown instructions → response length → humanizer → RAG resume → RAG job.
Волатильный хвост: language instruction → self-evolution block.
- Реализация: `buildEnhancedSystemPrompt` в `src/lib/functions/ai-response.function.ts` (owner: Fixer-B). Публичная сигнатура не меняется.

### C4. Adaptive VAD knobs (Rust-internal, no interface change)
- `VadConfig` не расширяется. Noise-floor оценивается внутри `run_vad_capture`: rolling min RMS (окно ~2с), эффективный порог = `max(config.sensitivity_rms, floor*3.0 + 0.004)`; `silence_chunks` по умолчанию 15 → 10 (~0.23с).
- Owner: Fixer-A (`src-tauri/src/speaker/commands.rs`). Публичных сигнатур нет.

### C5. SQLite pragmas at startup
```rust
pub fn apply_pragmas(db_path: &Path)
```
- Модуль: `src-tauri/src/db/main.rs` (owner: Fixer-A); вызов из `lib.rs::run()` рядом с `patch_migration_checksums` для обоих путей БД (config_dir, data_dir). `journal_mode=WAL`, `synchronous=NORMAL`, `temp_store=MEMORY`, `cache_size=-64000`, `foreign_keys=ON`. Ошибки — warn, не fail.

### C6. Streaming translation debounce (JS-internal)
- `SubtitleFeed.tsx`: парциальные (`e.streaming`) записи переводятся с дебаунсом 400мс по ключу текста; при росте текста ключ обновляется, предыдущий перевод не кешируется как финальный. Финал переводится как раньше.
- Owner: Fixer-B.

### C7. Assembler gap timers (JS-internal)
- `question-assembler.ts`: fast preset `flushGapMs` 800 → 550, `earlyEmitPauseMs` 500 → 400.
- `useQuestionPipeline.ts`: extended re-arm `gapMs * 2` → `Math.round(gapMs * 1.4)`.
- Owner: Fixer-B.

## Zone ownership (disjoint, parallel-safe)
- **Fixer-A (Rust)**: `src-tauri/src/speaker/commands.rs`, `src-tauri/src/api.rs`, `src-tauri/src/lib.rs` (только регистрация команды + вызов pragmas), `src-tauri/src/db/main.rs`.
- **Fixer-B (TS/JS)**: `src/hooks/useSystemAudioCapture.ts`, `src/hooks/useQuestionPipeline.ts`, `src/lib/question-assembler.ts`, `src/lib/functions/ai-response.function.ts`, `src/pages/app/components/speech/SubtitleFeed.tsx`.
- Пересечений нет; единственный контракт между зонами — C1/C2.
