# Executed integration evidence

Project cwd for all commands: D:/WORK/Pluely. No external provider endpoints or live user databases used.

## Deterministic validation
- `npm run build` — TypeScript + Vite succeeded after final correction: `✓ built in 24.23s`. Existing ONNX eval, chunk-size and mixed dynamic/static import warnings remain; not suppressed.
- `npm test -- --exclude '**/.tmp/**'` — final `Test Files 76 passed (76)`; `Tests 596 passed (596)`. Contained worktrees and throwaway smoke files excluded, not product tests. Final correction preserves token budgets, strips normalized credentials and disables/no-ops a same-provider alternative.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib` — `test result: ok. 73 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.10s`. Initial lock mismatch was root package version only (1.2.27 -> 1.2.30), reconciled offline; no dependency change. Initial plugin generic E0283 fixed by specifying unit config, then suite executed.
- `node D:/WORK/Pluely/.tmp/audit-audio/.tmp/audio-native-smoke.mjs` — actual committed Rust frame-completion helpers: `2 passed; 0 failed`.

## Actual network smoke
- `AUDIT_REPLAY_ORIGIN=http://127.0.0.1:34777 node .tmp/audit-request-smoke.mjs` (record proxy also exercised at 23669) — `AUDIT_REQUEST_SMOKE_OK: unsafe requests denied; headers sanitized; benign text preserved; warmup clean; trusted auth retained; 4 local HTTP exchanges`.
- `AUDIT_REPLAY_ORIGIN=http://127.0.0.1:34778 node .tmp/audit-stream-http-smoke.mjs` — `AUDIT_STREAM_HTTP_OK: fast answer; serialized-body denial; partial replacement; own model/key; real 25s late chunk; pending native fetch abort`.
- Production gate and generator loaded through Vite SSR; Tauri transport boundary forwards to native Node fetch against actual local HTTP fixture. User keys/remote endpoints untouched.
- Captured `.tmp/audit-request-cassette.json` and `.tmp/audit-stream-cassette.json` via D:/ohmypi/tools/replay.mjs record. Each verify returned `interactions 4 (2xx 4, 5xx 0)` and `cassette is structurally valid and redacted.`
- Strict replay served both cassettes. Request smoke succeeded unchanged; timing-neutral stream replay returned `AUDIT_STREAM_HTTP_REPLAY_OK: fast answer; serialized-body denial; partial replacement; own model/key; recorded late content. Stall timing and abort independently proven in direct live smoke.` Recorder buffers response timing, so real 25s delayed read/abort proof is direct live smoke, not a fabricated replay timing claim. Aborted request has no completed cassette response.

## Actual browser surface
- Chromium/CDP page 2: http://127.0.0.1:5173/audit-stream-ui.html, actual SubtitleFeed with deterministic props and IPC boundary adapter.
- Hydration/fonts awaited plus 300ms settle; screenshot `.tmp/audit-recovery-ui.png` inspected.
- Partial response displayed with Wait/Retry/Other/Providers controls; controls remain when feed paused.
- Wait clears stalled/status without changing partial answer; Other clears answer and displays separate switching status.
- Providers invoked existing open_dashboard_page with route `/dev-space` (captured IPC call); actual native dashboard launch not claimed by browser fixture.

## Limits
Physical WASAPI/microphone capture and installed desktop/provider services not exercised. Native packet suffix/order uses production Rust helper and real SQLite regression suite covers schema/migrations/WAL/snapshots/transitions, not user data. No prompt edits/new dependencies. Final provider-variable token-limit/no-alternative correction integrated and validated. Unknown checksum drift and destination collisions fail safely; snapshot cleanup after a settings write failure is best-effort, not a claim of full model/settings rollback.
