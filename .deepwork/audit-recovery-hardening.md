# Audit recovery hardening

Goal: fix R01-R15 from openspec/changes/audit-recovery-hardening/manifest.md; preserve user data/secrets/dirty changes.

Phase 1: inventory and contract — completed from audit runtime evidence and focused current-source reads. Glossary absent; existing domain names retained, no new CONTEXT.md.
Phase 2: five disjoint isolated implementation owners from interfaces.md: StreamFix, RequestFix, RecoveryUI, AudioFix, DataFix. Event/body/DB URL contracts defined before fan-out.
Phase 3: parent deterministic TS/Rust tests and actual smoke, then one bounded simplification review; validate API compatibility and sqlite data preservation before acceptance.
Phase 4: independent blind oracle vs manifest, double acceptance if configured fallback/flash; re-review only materially changed unresolved risks.

Rationale: stream loss and security boundaries require consumer-visible regression proof; portable migration additionally requires on-disk SQLite evidence. Existing audit established red scenarios; do not rerun them just to confirm.

Branch: fix/audit-recovery-20261001. Existing dirty paths from git diff are user-owned; src/pages/app/index.tsx must remain untouched.
No unresolved user tradeoff: without-secrets fail-closed, non-destructive DB copy, preserve required hosted licensing and document privacy accurately. No dependencies or prompt edits.

## Execution transport change
Native task() specialist batch returned five cancelled jobs with no assistant output or code. Transcript checks confirmed no implementation. Do not count those jobs as work completed.
Continued using available omp/openai-codex/gpt-6.1-sol through Paseo, with explicitly created contained worktrees under .tmp. Four implementation owners now run: stream+UI combined, audio, request security, portable data. Shared contracts and R01-R15 unchanged. This is an explicit orchestration deviation, not a scope reduction.

## Integrated evidence
Four implementation commits and two bounded integration fixes cherry-picked; current branch retains user dirty changes. Final npm build succeeded; TS 596/596 (76 files), Rust 73/73. Real HTTP smoke proves late 25s read, partial fallback, independent key/model, abort and credential policy. Strict recorded replay has four HIT exchanges per redacted cassette. Actual browser recovery component shows partial/paused controls and routes the provider action through /dev-space IPC.
One simplification pass reviewed guards and module seams: obsolete string sentinels, isFailureChunk and standalone stall-guard removed; no extra abstraction. Boundary findings (token budget filtering and same-provider Other) fixed with behavioral regressions. Physical capture/native dashboard launch not claimed. Independent blind acceptance remains.
