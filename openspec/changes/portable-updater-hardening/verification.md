# Executed verification — portable updater hardening

Integration branch fix/portable-updater-20261003, current implementation HEAD 2d1b4d0. No live installed app update/restart, remote push/release or human signing credentials used. Existing root user files remain outside implementation worktrees; R08 prerequisite copied only approved functions.

## Deterministic and real native runtime
- npm test: 76 test files passed, 604 tests passed (final output bg_27). Updater consumer filter separately 18 passed.
- npm run build: TypeScript and Vite passed, final built in 18.35s (artifact://281 footer). Existing ONNX eval/chunk-size/mixed-import warnings remain, not suppressed.
- cargo test --locked --offline --manifest-path src-tauri/Cargo.toml --target-dir D:/WORK/Pluely/src-tauri/target --lib --tests: 89 native unit tests passed; binary harness zero tests; 6 integration smoke tests passed (artifact://339), total95. Smoke uses built production pluely.exe helper before Tauri startup and independently rustc-compiled fixture executables in OS temp.
- Actual native smoke proves parent-exit wait, same-folder/name swap and relaunched replacement marker; invalid executable triggers restore/original relaunch; a real READ|WRITE/no-DELETE sharing violation blocks the first rename and still relaunches intact original. .portable plus .echo-ai settings/history/model bytes preserved; traversal/non-exe targets rejected.
- Security remediation holds the native single-flight guard after helper spawn until parent exit; local-AtomicBool regression proves second acquisition is rejected after handoff. Generic cleanup stops without modifying payloads if helper image cannot be removed; Windows no-DELETE handle regression preserves helper/replacement/backup. Orphan backups never deleted.
- Actual localhost HTTP positive signed ZIP passes Tauri Update.download signature verification and native staging; flipping signed ZIP byte rejects before staging. Keys generated only in OS-temp fixture and deleted; signer receives private-key FILE PATH, not key content in arguments/logs.
- Windows test loader issue independently diagnosed: failed EXE imports TaskDialogIndirect from comctl32 but had no Common-Controls6 manifest. Embedding manifest in isolated copied EXE changed --list from pre-main0xc0000139 to all5 tests. Permanent test-only linker manifest in build.rs makes original cargo suite run normally. No system DLL modifications.
- node scripts/test-portable-release.mjs: 26/26 behavioral boundary assertions passed. Actual supported signer command also exercised by native smoke. Runner executed with Node24.17.0; Node20 compatibility reviewed by eliminating unsupported crc32 dependency, not falsely reported as a Node20 execution.

## Actual browser surface (IPC boundary fixture, not native installation)
Production Updater and UpdateSettings, real React/Router/components/styles served at http://127.0.0.1:5173/.tmp/updater-browser.html. Tauri IPC boundary is an isolated fixture; any unexpected native action throws, no real app/hardware/data touched.
- mode=portable delays get_paths500ms. Both automatic and manual checks selected windows-x86_64-portable; no default installer check before layout. Settings install invoked install_portable_update expectedVersion9.9.9; installer0 and frontend relaunch0.
- mode=installed automatic check uses normal default target (no target override).
- mode=unknown presents Update check failed instead of hiding failure/guessing installed.
- mode=failInstall keyboard activates actual popover install button; backend rejection appears in role=alert, retry control remains, native install count1, installer0/relaunch0, no ready success.
- Fonts awaited and300ms settle before visual screenshot; inspected inline CDP capture. Configured browser filesystem ACL refused integration-root screenshot file path, so no saved screenshot falsely claimed. Native-window geometry is not claimed from web fixture.

## Network record/replay
Public actual v1.2.30 .sig fetched over HTTPS, relayed through local origin, recorded with D:/ohmypi/tools/replay.mjs. Production scripts/portable-release.mjs validateSignatureFormat accepted unchanged420-char envelope. .tmp/updater-signature-cassette.json verify:1GET/1HTTP200, structurally valid/redacted. Strict replay at15435 ran same consumer and accepted identical envelope.
Replay tool coerces binary to UTF-8 and redacts public JSON signature fields; it cannot prove signed ZIP crypto. Binary positive/tampered verification is the direct actual localhost HTTP native smoke above, not a fabricated binary replay.

## Limits and release state
No GitHub publish/push/version bump in this task. Human-key CI execution and live installed-app update not run. Windows portable only; installed updater preserved. User-approved copied prerequisite functions are a separate commit bf70a9f. Original root app remains untouched.

Native error-window proof completed after building the production helper in isolated .tmp/cargo-target (cargo build --locked --offline --bin pluely succeeded). Copied ONLY this helper into OS-temp staging and invoked unsafe fixture target with --show-update-error before Tauri init. Win32 inspector filtered ONLY its PID32528, observed visible native dialog \"Echo AI Update Error\" with \"Portable update failed: Invalid target executable name '../unsafe.exe'\" and OK button. Own helper terminated and fixture removed after observation; automation did not successfully press/dismiss OK and that is not claimed. No live app or unrelated window touched. Earlier failed dismissal probes remain a harness limit, not a fabricated native-window pass.
