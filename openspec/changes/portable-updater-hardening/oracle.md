# Blind acceptance — portable updater hardening

Final reviewed implementation snapshot 2d1b4d0. Resolved model nullform-gateway/gemini-3.8-flash-high (Flash-class, two independent gates required). Both reviewers received manifest.md/current artifact and verification.md, not proposal/specs/tasks/interfaces or each other's conclusions.

## Gate A — ACCEPT (final attempt 2 of 3)
R01 actual layout awaited before check/install. R02 native same-folder helper flow. R03 verified download before staging. R04 first-swap sharing violation relaunches intact original; rollback preserves data; active helper prevents staging cleanup; orphan backups retained. R05 installed updater path, progress/error/retry and native helper error reporting. R06 coherent signed draft publication. R07 604 TS and 95 native (89 unit + 6 real process/HTTP smoke) passed. R08 approved existing exports copied only in bf70a9f. Current source and safe browser fixtures inspected; no blocking concerns.

## Gate B — ACCEPT (final attempt 2 of 3)
Independent re-review of native remediation and every R01-R08 found no material gaps. Confirmed signature-before-stage, first-rename original recovery, held handoff lock, active-helper staging/backup preservation, installed path and release promotion ordering. Parent executed proof distinguished from untested live deployment.

Initial attempts accepted snapshot 0c41ee4. Independent security review then found two consequential native handoff/recovery defects; implementation was corrected and both blind gates repeated against 2d1b4d0. Initial verdicts were not used to bypass remediation.

## Limits
No live installed app restart, human signing credentials, remote release execution or push. Browser uses real production UI with an isolated native IPC fixture; native process/data safety is proven separately by OS-temp production-helper subprocess and direct signed/tampered localhost HTTP.

## Security gate — ACCEPT (final attempt 2 of 3)
Both findings resolved: first target-to-backup rename failure relaunches intact original and real-helper failure is reported natively; successful handoff retains the single-flight guard until exit and generic cleanup cannot modify staging owned by an active helper. No new source-level blocker. Native error-dialog visual proof is separately recorded by the integration owner; security review did not claim it had executed a dialog.

ACCEPT
