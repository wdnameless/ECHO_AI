## 1. Streaming and provider configuration
- [x] 1.1 R01 preserve pending read and abort settlement
- [x] 1.2 R02 final buffer snapshot
- [x] 1.3 R03 independent persisted provider configuration
- [x] 1.4 R04 partial-error fallback and separate control events
- [x] 1.5 R05 current-generation-only side effects/history
- [x] 1.6 R09 retry/next use active attempt

## 2. Audio capture
- [x] 2.1 R06 cancel pending/in-flight mic reconnect
- [x] 2.2 R11 final PCM tail and safe mic handoff WAV fallback

## 3. Request policy
- [x] 3.1 R07 without-secrets URL/body enforcement
- [x] 3.2 R14 gated warmup and remove native bypass

## 4. Recovery UI
- [x] 4.1 R08 empty/partial stall controls and visible switching status
- [x] 4.2 R10 real provider page navigation

## 5. Data integrity
- [x] 5.1 R12 restricted EOL checksum repair
- [x] 5.2 R13 portable DB URL/migrations and lossless mode switch

## 6. Acceptance
- [x] 6.1 full TS and Rust validation plus focused runtime smoke
- [x] 6.2 R15 accurate privacy/storage docs after smoke
- [x] 6.3 one simplification pass and independent blind acceptance
