# Recon: credits and web pages shown as the interviewer's speech

## Reported (screenshots)
1. «Субтитры сделал DimaTorzok» appeared in the feed as the interviewer's own
   line, and the AI answered it («Ну вот, логичный итог неудачного дела…»).
2. The trust dialog asked to send a request to host
   `null/v1/asr/transcribe?language=ru`.
3. `<!DOCTYPE html>…<title>Tauri + React + Typescript</title>` appeared in the
   feed, again as the interviewer's speech.

## Files touched
- `src/lib/asr-hallucinations.ts` (new) — scrub of recogniser credit boilerplate.
- `src/lib/asr-stream-frame.ts` — scrub at the WS boundary (both channels).
- `src/lib/functions/stt-fallback.ts` — scrub at the HTTP boundary; error
  semantics preserved before scrubbing.
- `src/lib/functions/stt.function.ts` — refuse markup and non-absolute URLs.
- `src/lib/host-trust-gate.ts` — absolute-URL check before the trusted check.
- `src/lib/trusted-hosts.ts` — refuse artifact hostnames (`null`, `undefined`,
  `nan`) and entries not shaped like a host.

## Root causes (measured, not inferred)
- Credits: Whisper-family models emit subtitle-credit vocabulary over
  non-speech audio. Verified by the screenshots plus the phrases' shape; the
  scrub is bounded so real words around a credit survive.
- `null` host: `getHostOfCurlTemplate` returns null for a scheme-less URL, and
  `?? url` fell back to the whole URL, so the dialog quoted it and `trustHost`
  stored `null`. Evidence: `trusted_hosts: ["null"]` was found in the app's
  localStorage, matching the dialog screenshot.
- HTML: a scheme-less URL resolves against the WebView origin. Verified live via
  CDP — `fetch("null/v1/asr/transcribe?language=ru")` returns
  `HTTP 200 text/html` starting with `<!DOCTYPE html>`, i.e. the app's own page.
  The non-JSON catch-all returned that body as the transcription.

## Acceptance check
- 463 tests pass, `tsc --noEmit` clean.
- All five guards proven non-vacuous: removing each makes its test fail
  (3 tests / 1 test / 1 test / 2 tests respectively).
