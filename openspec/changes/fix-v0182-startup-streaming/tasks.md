# Tasks: fix-v0182-startup-streaming

## P0: Migration & Startup Reliability
- [ ] P0.1 **SQL LF & Checksum Lock**: Lock byte-level checksums for migrations 1..4 in `src-tauri/src/db/migrations/` to guarantee newline LF invariance across OS environments.
- [ ] P0.2 **Migration Idempotency & Data Safety**: Ensure existing databases at migration version 4 initialize without re-running past migrations and preserve all existing table data without data loss.
- [ ] P0.3 **Startup Error Guard**: Wrap database initialization in graceful fallback so corrupt locks or missing plugins report actionable status without silent app termination.

## P1: Speech Streaming, Isolation & Fillers
- [ ] P1.1 **Stable Transcript Identity**: Ensure partial-to-final streaming transcript transitions preserve item identity keys so subtitles never flicker, jump, or disappear in `SubtitleFeed`.
- [ ] P1.2 **Microphone AI Isolation Guard**: Enforce strict guard preventing any microphone final transcript (`source: "me"`) from automatically invoking AI inference pipelines.
- [ ] P1.3 **Explicit Ask AI Action**: Implement deterministic single-execution trigger for manual "Ask AI" actions from transcript or quick-action controls without duplicate requests.
- [ ] P1.4 **Single Russian Filler Lifetime**: Maintain at most one pending Russian conversational filler during AI generation delay (1-5s), clearing immediately upon first received token, error, or cancellation.

## P2: Release Verification & Reproducibility
- [ ] P2.1 **Signed Updater Manifests**: Validate that `latest.json` and `.sig` updater artifacts are correctly signed and match release binaries for v0.1.82.
- [ ] P2.2 **Tagged Checkout Reproducibility**: Verify tagged commit checkout produces identical, reproducible build artifacts for v0.1.82 release distribution.
