## ADDED Requirements

### Requirement: Stable Streaming Transcripts
Transcripts streamed from speech recognition MUST maintain continuous identity during transitions from interim (partial) hypotheses to final recognized text.

#### Scenario: Partial-to-final transcript never disappears
- **Given** an ongoing speech stream emitting partial/interim transcript text in the subtitle feed
- **When** the final speech recognition result is received for that utterance
- **Then** the existing transcript element updates in-place to final state
- **And** the transcript entry never momentarily disappears, unmounts, or shifts order in the UI

### Requirement: Microphone AI Isolation
Final transcripts from the user's microphone (`source: "me"`) MUST NEVER automatically trigger an AI response.

#### Scenario: Mic final never invokes AI
- **Given** an active microphone audio stream
- **When** a user speaks into the microphone and a final transcript is produced
- **Then** the transcript is displayed in the conversation history feed
- **And** no automated AI generation request is dispatched to any AI provider

### Requirement: Explicit Manual "Ask AI" Trigger
Users MUST be able to explicitly invoke AI on any query or transcript via dedicated manual action, executing exactly once.

#### Scenario: Explicit Ask AI exactly once
- **Given** a transcribed utterance or selected text in the UI
- **When** the user clicks the explicit "Ask AI" button
- **Then** exactly one AI generation request is sent to the configured provider
- **And** subsequent clicks while generating are ignored or debounced

### Requirement: Russian Filler Lifecycle
When waiting for AI model inference during an active question, exactly one organic Russian filler MUST be displayed in pending state and cleared as soon as streaming begins or terminates.

#### Scenario: Filler lifetime pending-to-first-token/error/cancel
- **Given** an active AI question request awaiting first token response
- **When** the request enters inference delay
- **Then** exactly one pending Russian conversational filler is selected and displayed
- **And** when the first response token arrives, an error occurs, or the request is cancelled
- **Then** the pending filler is immediately cleared from the UI
