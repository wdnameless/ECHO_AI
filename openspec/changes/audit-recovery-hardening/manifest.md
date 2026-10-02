# Audit recovery hardening — requirements manifest

User authorization: "Приступай к фиксу"; continuation: "Продолжай". Scope is the weaknesses in the immediately preceding audit, not unrelated redesign.

| ID | Verbatim user quote | Required observable behavior |
|---|---|---|
| R01 | "Приступай к фиксу" | Preserve the original pending reader.read across STALL; no first late chunk or one-event response loss. |
| R02 | "Приступай к фиксу" | Final buffered response displays even when completion precedes the 80 ms flush. |
| R03 | "Выбранный, затем остальные по списку" | Fallback uses each provider's own saved variables/model and own secure key; no primary-provider parameter contamination. |
| R04 | "Любая ошибка провайдера"; "Показать «переключаю» и начать заново" | Provider failure before or after content switches to next candidate, replaces partial answer, and shows status separately from answer/history. |
| R05 | "Приступай к фиксу" | Canceled/superseded generations cannot change UI, error state, buffers, finalization or committed history; abort releases pending waits. |
| R06 | "Приступай к фиксу" | Mic utterance stop cancels reconnect, including in-flight connect, and releases ASR ownership. |
| R07 | "Приступай к фиксу" | without-secrets cannot send credential-bearing URL/body; deny unsafe forms if safe removal is not possible; headers remain sanitized. |
| R08 | "Ждать + Повторить + Другой"; "Продолжает ждать молча" | Recovery controls remain available after partial content; waiting never auto-fails or auto-retries. |
| R09 | "Оба: быстрый следующий + выбор" | Retry repeats active attempt; Other advances from active attempt, not global selection; global provider choice remains unchanged. |
| R10 | "Оба: быстрый следующий + выбор" | Providers action opens real /dev-space AI provider selection, not unrelated audio settings/dead custom event. |
| R11 | "Приступай к фиксу" | Native capture sends un-emitted final PCM tail before speech-detected/finalize; mic handoff does not discard full WAV fallback. |
| R12 | "Приступай к фиксу" | Checksum repair accepts only recognized EOL equivalence; arbitrary schema/migration drift remains rejected. |
| R13 | "Приступай к фиксу" | Portable history uses portable SQLite file with registered migrations; preserve existing databases and WAL contents, no overwrite/data loss; mode switch is safe and explicit. |
| R14 | "Приступай к фиксу" | All warmup requests obey host trust, carry no query/body credentials and do not bypass policy via an obsolete native command. |
| R15 | "Приступай к фиксу" | Docs accurately state portable storage, local/cloud data boundaries, hosted usage/error reporting and PostHog behavior; required license accounting remains intact. |

Acceptance: deterministic regression scenarios, actual runtime smoke for streams/recovery UI/HTTP policy and SQLite migration, full TS and Rust validation, independent blind requirements review. Live user databases, secrets and unrelated dirty changes remain untouched.
