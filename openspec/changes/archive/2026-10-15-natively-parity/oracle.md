# Oracle — S7 double blind acceptance (natively-parity)

Model: nullform-gateway/gemini-3.8-flash-high (flash-class → double pass mandatory).
Judged against: `manifest.md` (R01–R21 verbatim) + running runtime. Specs forbidden to oracles.

## Pass A (IncreasedCrane) — Verdict: ACCEPT

Per-R evidence (commands executed by oracle, cwd noted):
- R01 PROVEN — save→indexTranscript; vitest chat-history-index-wiring + memory-index: 2 files / 9 tests.
- R02 PROVEN — local default + cloud BYOK; embeddings.test.ts: 1/5.
- R03 PROVEN — sqlite-vec vec0; cargo test memory::tests: 2 passed.
- R04 PROVEN — resume/job contexts intact; rag-context + ai-response.rag-memory: 2/6.
- R05 PROVEN — Deepgram WS bridge; deepgram + deepgram-bridge: 2/18.
- R06 PROVEN — StreamingSTTProvider seam; streaming.test.ts: 1/5.
- R07 PROVEN — local default, cloud opt-in; audio-cloud-stt-wiring: 1/3.
- R08 PROVEN — trusted-hosts gate; trusted-hosts.test.ts: 1/6.
- R09+R11 PROVEN — TOOLWINDOW/affinity; cargo window::tests: 5 passed; stealth TS: 2/7.
- R10 PROVEN — no process masking (window.rs:99 hard ban).
- R12 PROVEN — 4 personas; personas + PromptProfilesSettings: 2/16.
- R13 PROVEN — DOCX local; docx.test.ts: 1/5.
- R14 PROVEN — export md/json; history-export.test.ts: 1/7.
- R15 PROVEN — mermaid render; mermaid-renderer.test.tsx: 1/6.
- R16 PROVEN — trigger matrix; visual-answers.test.ts: 1/38.
- R17 PROVEN — portable CI; test-portable-release.mjs: 36/36.
- R18 PROVEN (scope edge) — Win-only, no mac/linux/signing.
- R19–R21 HONOURED AS DEFERRED.
- Full: cargo 110 lib + 6 smoke; vitest 110/884; tsc 0 errors.

## Pass B (TensePuffin) — Verdict: ACCEPT

All gates R01–R21 true. Full: cargo 116 (110 lib + 6 smoke), vitest 110/884, tsc clean.

## Reconciliation

- Both passes agree: ACCEPT + ACCEPT → S7 ACCEPT.
- 110/116 discrepancy explained: 110 = lib, 116 = lib + smoke. Same code, same green.
- Parent spot-check: vitest memory-index + streaming 2 files / 10 tests green;
  cargo memory filter 3/3 green (wider filter than oracle's, superset green).

## Reviewer loose ends (Wave 3.5, for the record)

- 2 delete-list anchors honestly skipped by Stage-B (verified by parent): RS
  `local_embed_text` has live callers (index_chunks_conn:125, search_memory_conn:160)
  serving the offline default R02; `ensure_memory_tables` owns the vec virtual table
  absent from migration 9 and needed by frozen in-memory tests.
- `workflow.mjs` lacks `review-run`/`stage-b` verbs (protocol newer than tooling):
  Wave 3.5 ran via native reviewer + manual Stage-B with frozen tests.

## Verdict: ACCEPT
