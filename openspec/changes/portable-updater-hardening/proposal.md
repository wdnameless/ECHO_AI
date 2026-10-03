## Why
Portable auto-update is broken: the published feed lacks its target, checks race storage-layout discovery, and the standard Windows updater launches a portable EXE as an installer rather than replacing it. Existing UI promises in-place updates that do not occur.

## What Changes
- Select updates only after the active layout is known, in both existing update controls.
- Install signed Windows portable updates in the same folder after the app exits, preserving data and keeping rollback available on failure.
- Correct signing/publication so a release is not published as complete without its portable package.
- Prove behavior using temporary executable/data fixtures; do not touch the running user's app.

## Capabilities
### New Capabilities
- `portable-update-hardening`: safe portable package selection, publication and in-place replacement.
### Modified Capabilities

## Impact
Updater frontend, Windows native updater/startup seam, release workflow, updater regressions and README. Installed MSI/NSIS updating and portable storage layout remain unchanged. No remote publication is authorized.
