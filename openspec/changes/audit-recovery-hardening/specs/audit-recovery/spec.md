## ADDED Requirements

### Requirement: Preserve complete current-generation responses
The system SHALL preserve pending reads across stall, flush final buffers, discard stale generation side effects and restart partial failed answers on the next independently configured provider.

#### Scenario: Late one-event answer
- **WHEN** a pending read exceeds stall budget and later resolves with the only response event
- **THEN** that event is displayed and saved exactly once, without replacement reads stealing it

#### Scenario: Provider fails mid-answer
- **WHEN** provider A emits partial text and then fails
- **THEN** provider B uses its own config; switching status is visible, A text is replaced, and only B completed content enters history

#### Scenario: Generation superseded
- **WHEN** a request is canceled or superseded
- **THEN** it cannot change current answer, errors, buffers or committed history

### Requirement: Keep recovery and audio ownership usable
The system SHALL expose wait/retry/other and actual provider selection during empty or partial stalls. It SHALL cancel mic reconnect on utterance end and flush remaining native PCM before finalization.

#### Scenario: Mid-stream stall
- **WHEN** partial response exists and provider stalls
- **THEN** recovery controls remain usable and no automatic surrender or retry occurs

#### Scenario: Mic speech ends during reconnect
- **WHEN** reconnect is pending or lookup is in-flight and speech ends
- **THEN** mic does not acquire or hold the interviewer model afterward

#### Scenario: Final audio tail
- **WHEN** an utterance ends between regular streaming frame boundaries
- **THEN** the un-emitted PCM tail precedes the finalization signal

### Requirement: Honor full request trust and storage integrity
The system SHALL enforce without-secrets for headers, URL and body; warmup SHALL use the same policy. Portable history SHALL use portable SQLite with migrations and consistent non-destructive transfer. Checksum repair SHALL not mask arbitrary SQL changes.

#### Scenario: Credential-bearing payload refused
- **WHEN** without-secrets is selected for a request with credential query/body data
- **THEN** no unsafe request leaves the app

#### Scenario: Portable existing history
- **WHEN** portable mode selects a new DB location
- **THEN** registered migrations match the loaded URL and existing history/WAL remain preserved without overwriting an existing destination

#### Scenario: Unknown migration drift
- **WHEN** a stored checksum is neither expected LF nor equivalent CRLF
- **THEN** startup does not silently replace it
