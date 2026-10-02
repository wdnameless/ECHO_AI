## Why
The audit reproduced lost late AI responses, disappearing final buffers, incorrect provider fallback, stale generation writes, mic ownership starvation and incomplete without-secrets enforcement. Source inspection also found hidden recovery controls, lost audio tails, unsafe checksum repair and non-portable chat storage.

## What Changes
- Repair existing streaming and capture lifecycles rather than rewrite the application.
- Keep answer text separate from provider/stall/restart control events.
- Resolve each provider's saved non-secret settings and secure key independently.
- Keep recovery controls available for partial responses and open the existing provider screen.
- Apply the same outbound trust policy to full requests and warmup.
- Register SQLite migrations for the actual active database path and preserve existing history safely.
- Correct privacy/storage documentation without disabling mandatory licensing.

## Capabilities
### New Capabilities
- `audit-recovery`: reliable response/capture recovery, complete outbound policy and portable database integrity.

### Modified Capabilities

## Impact
React streaming hooks and speech UI; Tauri capture/database startup; request trust gate; provider settings persistence. No new external dependencies, prompt edits, production service calls, or unrelated changes.
