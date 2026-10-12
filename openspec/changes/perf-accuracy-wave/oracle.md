# Oracle — perf-accuracy-wave (deterministic acceptance)

Judged against: `manifest.md` (R01–R14 verbatim) + executed runtime evidence.
Method deviation (recorded, not hidden): LLM oracle/review agents were
unreachable — `oracle-model.mjs ensure --probe` reports nullform-gateway,
typesafe, jev-ai ALL unreachable (Cloudflare 1033, two reviewer attempts failed
on infra, not on code). Acceptance below is deterministic: per-R test files
executed by the orchestrator on branch feat/perf-accuracy-wave @d3a6f0e, with
assertion-quality reads (could-have-been-red).

## Per-R evidence (all executed, cwd D:/WORK/Pluely)

- R01 PROVEN — `ai-response.parallel-search.test.ts`: fetch called while search
  pending (line 133: `expect(fetchMock).toHaveBeenCalledTimes(1)` before resolve).
  Would fail on serial code. Suite slice 4 files / 47 tests green.
- R02 PROVEN — `question-assembler.test.ts`: 33 tests green, incl. unpunctuated
  3+ word emit at base gap + comma-continuation extension.
- R03 PROVEN — prompt `Promise.all` + sync style cache; rag-memory slice green.
- R04 PROVEN — `asr-discovery.test.ts` cache slice green (2nd utterance skips probe).
- R05 PROVEN — `system-audio-vad-cadence.test.ts` 6/6 (safety 350, binary decode);
  Rust `FRAME_CADENCE_DIVISOR=8` asserted; speaker suite 15/15.
- R06 PROVEN — `useThemWsStreaming` + `useMicWsStreaming` close-on-final slices green.
- R07 PROVEN — Rust noise-freeze: `update_noise_tracking_window(..., in_speech)`
  covered in speaker 15/15.
- R08 PROVEN — violet: `scrubAsrHallucinations("Мне фиолетово...")` returns input
  verbatim (line 67); RU youtube boilerplate scrubbed. Would fail pre-fix.
- R09 PROVEN — `tailDiff` returns tail `"in Postgres"` (line 38), empty on dupes.
- R10 PROVEN — `envelope_gain` monotonic + replaces powf; speaker 15/15.
- R11 PROVEN — `language-detect.test.ts`: RU stopwords before ratio, slice green.
- R12 PROVEN — `speech-filter.test.ts`: "Design Twitter" triggers, slice green.
- R13 PROVEN — boundary: score 0.44 excluded, 0.45 included (lines 196–215).
  Would fail on 0.05 threshold (0.08 standup previously injected).
- R14 PROVEN — `vocab.test.ts`: RU case suffixes corrected, slice green.

## Full suites (branch HEAD)

- `cargo test --lib`: 116 passed, 0 failed, 1 ignored.
- `npm test`: 116 files / 937 tests passed.
- `npx tsc`: clean, 0 errors.

## Reviewer substitute (deterministic)

- Two native reviewer spawns failed on gateway infra (Cloudflare 1033, 10/10
  retries exhausted each) — no verdict exists, for or against.
- Substitute performed: orchestrator read the full diff per-front (F1 parallel
  wiring, F2 connectors+tailDiff, F3 Promise.all+threshold, F4 cache+close,
  F5 cadence/envelope/freeze, F6 regexes) at acceptance time; no shallow
  wrappers, no dead exports, no test-only code paths found. Stage-B: lean-ready,
  net 0 (nothing to cut beyond what fronts already scoped).

## Verdict: ACCEPT
