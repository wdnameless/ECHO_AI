# Design: v0.1.82 Startup, Streaming Transcript & Release Hardening

## Architecture Overview

```
+-----------------------------------------------------------------------------------+
| Pluely v0.1.82 Runtime Architecture                                               |
+-----------------------------------------------------------------------------------+
| [Desktop Startup]                                                                 |
|   |--> tauri-plugin-sql: sqlite:pluely.db                                          |
|   |      * Migrations 1..4 (LF line endings, fixed checksum hash)                 |
|   |      * Idempotent check: migration 4 preserved, existing tables untouched     |
|   |                                                                               |
| [Audio & Speech Streaming Engine]                                                 |
|   |--> System Audio (them) ---> QuestionAssembler ---> Automated AI Trigger       |
|   |                                                         |                     |
|   |--> Mic Audio (me) --------> SubtitleFeed Only          v                     |
|   |      * Strict Guard: NEVER auto-invoke AI        [AI Inference 1-5s]          |
|   |      * UI Speech Row Identity: Stable key               |                     |
|   |                                                         |--> 1 Pending Filler |
|   |--> User Manual Action: "Ask AI" button                  |    (Russian natural)|
|          * Single Execution Guard                           v                     |
|          * Explicit invoke AI exactly once ----------> First Token / Error / Cancel|
|                                                        (Filler cleared immediately)|
|                                                                                   |
| [Release & Updater Pipeline]                                                      |
|   |--> v0.1.82 Tagged Checkout                                                    |
|   |--> Deterministic build & signed latest.json + .sig updater artifacts          |
+-----------------------------------------------------------------------------------+
```

## Technical Decisions & Specifications

### 1. Database Migrations & LF Checksum Lock (P0)
- **Problem**: `tauri-plugin-sql` computes checksums over migration SQL files. Any newline conversion (CRLF vs LF) or formatting change alters the checksum, causing startup crash (`migration checksum mismatch`) on existing user databases.
- **Decision**:
  - Enforce explicit LF line endings (`.gitattributes` or build-level verification) on all `.sql` migration files in `src-tauri/src/db/migrations/`.
  - Migrations 1, 2, 3, and 4 are strictly immutable byte sequences.
  - Startup migration validation must ensure databases at migration version 4 execute 0 new migrations and maintain table integrity without data loss.

### 2. Transcript Identity & Partial-to-Final Stability (P1)
- **Problem**: Partial transcription results (`interim`) arrive with incrementing timestamps or temporary IDs. When replaced with the `final` segment, visual feed elements flicker, dismount, or temporarily vanish.
- **Decision**:
  - Introduce deterministic transcript entry identity tracking keyed by `stream_id + speaker + utterance_id`.
  - An interim segment updates the existing entry in-place. When the final segment arrives, it seals the existing entry in-place rather than unmounting and creating a new record.
  - Transcript rows maintain monotonic ordering and consistent React keys across streaming updates.

### 3. Microphone Audio AI Trigger Isolation (P1)
- **Problem**: Accidental or unintended AI answers triggered by user speech into the microphone.
- **Decision**:
  - `triggerAIForQuestion` in `useSystemAudio` strictly rejects `source === "me"`.
  - Microphone finals are dispatched only to `recordContextMessage` for transcript history display.
  - No automated AI inference pipeline is ever initiated from microphone inputs.

### 4. Explicit "Ask AI" Manual Invocation (P1)
- **Problem**: When a user actively wants AI assistance on their spoken input or a selected query, clicks must not double-fire or get dropped.
- **Decision**:
  - Implement an explicit `handleAskAI(text, screenshot?)` handler guarded by `isGeneratingRef` and debounce locks.
  - Exactly one AI request is dispatched per user click, passing the explicitly selected transcript text.

### 5. Single Pending Russian Filler Lifecycle (P1)
- **Problem**: While waiting for LLM response generation (1-5s TTFT), natural conversational Russian interview fillers must reassure the speaker without cluttering the screen or accumulating multiple pending fillers.
- **Decision**:
  - State machine: `idle` -> `pending_filler` (on AI query start) -> `streaming` (on first token) | `error` | `cancelled`.
  - At most one filler is active at any time.
  - State transition to `streaming`, `error`, or `cancelled` unconditionally clears the pending filler.

### 6. Updater Integrity & Release Reproducibility (P2)
- **Problem**: Updates failing signature checks or inconsistent build artifacts between dev and release tags.
- **Decision**:
  - All release assets are signed using minisign / Tauri updater private keys, producing valid `.sig` signatures.
  - `latest.json` contains exact SHA256 hashes, signatures, and release notes corresponding to the immutable v0.1.82 release tag.
