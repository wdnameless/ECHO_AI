# Portable updater hardening — requirements manifest

| ID | Verbatim user quote | Required observable behavior |
|---|---|---|
| R01 | "Не работает автообновление в портабл версии, проверь"; "Давай исправим" | Automatic checks wait for the native storage layout; delayed portable detection never selects MSI/NSIS, and unknown layout cannot install an arbitrary default. |
| R02 | "Давай исправим" | Both automatic/popover and Settings installation paths use a real Windows portable updater, replacing the current executable in its existing folder, not launching a portable EXE as an installer. |
| R03 | "Давай исправим" | Portable archive signatures are verified using the configured Tauri updater public key before staging/replacement; invalid signature/version/package rejects without modifying the running executable/data. |
| R04 | "Давай исправим" | Replacement waits for the original process to exit, retains/restores the previous executable on replacement/relaunch failure, and preserves .echo-ai, settings/models/history and the existing executable name. |
| R05 | "Давай исправим" | Installed copies keep the supported MSI/NSIS updater path and existing UI behavior; portable progress/errors are surfaced through existing controls. |
| R06 | "Давай исправим" | Release workflow signs with supported CLI options and publishes matching ZIP/signature/portable-target; a partial failed portable release is not promoted as latest. |
| R07 | "Давай исправим" | Deterministic regression checks plus actual production-helper smoke exercise delayed layout, signed payload rejection, successful same-folder swap, rollback and data preservation, using only isolated worktree/OS temp fixtures. |
| R08 | "Включить только нужные экспорты" | Restore only the existing user-owned findCodeRequestInHistory (+ CODE_VERBS) and buildMetricsDump implementations in a separate prerequisite commit; preserve the root working copy and every other user change. This explicitly authorized prerequisite makes the clean branch build independently. |

Scope: implementation and local proof only; no remote push, version release, live app restart, live database changes, or access to human signing credentials. Earlier portable-inplace-update acceptance incorrectly assumed the stock Windows updater could replace a raw EXE; this change supersedes that assumption, not storage layout behavior.
