# Proposal: v0.1.82 Startup, Streaming Transcript & Release Hardening

## Why
During real-world deployment and testing of Pluely v0.1.81/v0.1.82, several critical reliability issues were identified across startup, speech transcription, AI triggering, and release signing:
1. **Migration & DB Startup**: Existing user SQLite databases running schema migration 4 experienced launch failures or potential data loss if migration files had CRLF/LF line ending churn or altered checksums.
2. **Transcript Flickering & Disappearance**: During continuous speech recognition, transitioning from partial (streaming) transcript to final transcript caused temporary disappearance or row jumping in the subtitle feed.
3. **Unintended AI Triggering from Microphone**: Microphone final transcripts were occasionally triggering automated AI responses without explicit user action, conflicting with conversational privacy and UX intent.
4. **Manual "Ask AI" Reliability**: Users lacked a deterministic single-click trigger to submit explicit speech context to AI exactly once without duplicate executions.
5. **Russian Filler Delay Lifecycle**: While waiting for AI model inference (1-5s delay), natural conversational Russian fillers must appear in pending state and cleanly transition/clear upon first generated token, error, or cancellation without leaking multiple pending fillers.
6. **Release & Updater Integrity**: Auto-updater artifacts (`latest.json`, `.sig`, and installer binaries) require strict deterministic signing, immutable migration bytes, and verifiable reproducible release metadata for v0.1.82.

## What Changes
1. **P0 / Migration & Startup Reliability**:
   - Lock SQLite migration byte sequences (LF normalization, strict immutable checksum lock).
   - Guarantee existing databases with migration 4 launch safely and idempotently without data loss or re-running completed migrations.
2. **P1 / Stable Speech & Transcript Streaming**:
   - Establish stable transcript identity keys preserving row continuity across partial-to-final transcript transitions.
   - Enforce absolute isolation between microphone final transcripts and automated AI triggering (microphone finals are display-only in speech feed).
   - Implement explicit "Ask AI" manual trigger executing exactly once per user invocation.
   - Enforce single pending Russian filler lifetime: display pending filler during inference, dismiss immediately on first token emission, error, or request cancellation.
3. **P2 / Release & Updater Verification**:
   - Verify signed updater manifests (`latest.json`, `.sig`) against release public keys.
   - Guarantee tagged checkout reproducibility for v0.1.82 release binaries and assets.

## Capabilities & Impact
- **Capabilities Affected**: `startup-and-database`, `speech-and-streaming`, `release-and-updater`.
- **Database**: `sqlite:pluely.db` schema migrations 1..4 locked; zero destructive changes.
- **Frontend / Audio**: `useSystemAudio`, `transcript-stabilizer`, `question-assembler`, `speech-filter`, `SubtitleFeed`.
- **Rust / Tauri Backend**: `tauri-plugin-sql`, `tauri-plugin-updater`, release build pipeline.

## Verification
- Acceptance test suite with Given/When/Then scenarios covering:
  - Startup migration idempotency & zero data loss.
  - Transcript partial-to-final identity persistence without UI flicker.
  - Microphone final transcript isolation from automated AI invocations.
  - Explicit Ask AI single execution guard.
  - Pending Russian filler lifecycle (pending -> token/error/cancel).
  - Signature verification on updater assets and reproducible v0.1.82 release artifacts.
