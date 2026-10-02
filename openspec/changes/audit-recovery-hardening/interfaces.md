# Interfaces and ownership

## Streaming owner — StreamFix
Owns ai-response.function.ts, useAIStreaming.ts, useCompletionCommon.ts, their tests, app.context.tsx, storage/ai-providers.ts, config/constants.ts, dev/ai-configs/Providers.tsx and related provider tests. Preserve fetchAIResponse AsyncIterable<string> for answer content; add optional onEvent callback with exported AIStreamEvent discriminated union:
- { type: "attempt"; providerId: string }
- { type: "restart"; providerId: string }
- { type: "stalled"; providerId: string }
Control signals never enter text. Remove STALL_SENTINEL/isFailureChunk conventions and migrate all consumers/tests. Hook exposes aiStatusMessage (string), active provider internally, existing isStalled/stall actions/stallNextId. Current signal/generation owns every write. Snapshot pending read and flush buffers; abort races every long wait.
Provider-variable map is persistent, non-secret, keyed by provider id in existing storage; selected config remains source of truth for selected candidate. Other providers use their own stored variables or template defaults, never primary variables. Existing OS secretKey stays unchanged.
Actual provider storage APIs: getAIProviderVariables(providerId), setAIProviderVariables(providerId, variables), nonSecretAIProviderVariables(variables). Token-count/budget configuration is retained; credential field names are excluded. No-alternative stallNextId is undefined and Other is disabled/no-op.

## Security owner — RequestFix
Owns host-trust-gate.ts, trust tests, models.function.ts, stt.function.ts, useWarmup.ts, useQuestionPipeline.ts, native api.rs. Extend resolveOutboundHeaders with optional third payload (body string/FormData/null); header-only calls retain meaning. It inspects URL userinfo/credential query fields and credential fields in body before decisions; without-secrets denies request if URL/body cannot safely be sent rather than leaking credentials. gatedFetch passes payload. StreamFix MUST pass serialized AI body to resolver. Frontend warmup uses existing gatedFetch on credential-free origin with 1500ms abort and closed redirects. Remove obsolete native warm_llm_connection implementation; DataFix removes its registration.

## UI owner — RecoveryUI
Owns SubtitleFeed.tsx, ResultsSection.tsx, speech/index.tsx, useSystemAudio.ts forwarding and their UI tests. Preserve layout; recovery controls outside empty-response conditional. Thread optional aiStatusMessage from hook through existing speech pipeline. Provider link uses invoke open_dashboard_page route /dev-space; delete dead open-providers event. Does not edit useAIStreaming or app.context.

## Audio owner — AudioFix
Owns useMicWsStreaming.ts, useThemWsStreaming.ts if needed, useSystemAudioCapture.ts, native speaker/commands.rs and audio tests. Does not edit useSystemAudio.ts (UI owns it). Epoch per utterance/connect avoids ownership release by stale socket. Cancel reconnect and invalidate in-flight starts on stop; flush final remaining PCM before speech-detected in normal and capped utterance end; if mic owns model, preserve WAV batch final instead of early returning without a usable interviewer stream.

## Storage owner — DataFix
Owns src-tauri/src/lib.rs, db/main.rs, settings.rs, commands as needed, tauri.conf.json, frontend database/config.ts, storage/app-paths.ts and portable settings surface/tests needed for safe switch. Remove obsolete api::warm_llm_connection registration. Runtime resolved DB URL must be identical for SQL migration registration and frontend load; static appdata preload must not recreate host DB in portable mode. Existing portable destination wins; missing destination gets consistent SQLite snapshot with WAL, original retained; error rolls back without overwriting user DB. Mode switches cannot strand live DB writes. Unknown checksum drift untouched/rejected; only current LF/CRLF equivalent accepted.
Actual storage APIs: get_database_url() -> Result<String, String> returns session-frozen URL. Commands expose restart_required; mode transition snapshots only on next startup, capturing post-click writes. Explicit conflicting target fails without overwriting either history; ordinary existing portable target wins. Windows uses no-replace write-through publication; non-Windows requires hard-link support. Snapshot cleanup after settings failure is best-effort, not full settings/model rollback.

## Integration owner — parent
Owns spec, manifest, tasks, deepwork state and README privacy/changelog update after smoke. No product code edits on T2. Writers isolated; parent preserves user dirty files (including src/pages/app/index.tsx). Agents MUST not run build/lint/tests/formatters mid-flight; record regression tests, checks run once after integration. Regression executions in earlier audit already establish red behavior.
