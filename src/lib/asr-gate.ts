/**
 * The pluely-asr sidecar accepts ONE active stream per model: a second one is
 * rejected with `stream begin failed: model busy`, and while a stream is open
 * even the plain HTTP transcription answers
 * `500 transcription failed: model busy: a stream is active on this model`.
 *
 * The app runs two channels (the candidate's microphone and the system audio of
 * the other side), each with its own stream, and finishes utterances through
 * HTTP. Without coordination the second stream and every batch call race the
 * first stream: partial text disappears, finals come back as 500, and the feed
 * looks broken.
 *
 * This gate makes the constraint explicit: one owner at a time, and HTTP work
 * waits until no stream is open.
 */

export type AsrStreamOwner = "me" | "them";

let activeOwner: AsrStreamOwner | null = null;
const waiters = new Set<() => void>();

/** True when a stream may be opened for this owner right now. */
export function tryAcquireStream(owner: AsrStreamOwner): boolean {
  if (activeOwner !== null && activeOwner !== owner) return false;
  activeOwner = owner;
  return true;
}

export function releaseStream(owner: AsrStreamOwner): void {
  if (activeOwner !== owner) return;
  activeOwner = null;
  for (const wake of [...waiters]) wake();
}

/**
 * Runs `fn` once nothing is streaming.
 *
 * The caller keeps whatever it was doing (a final utterance over HTTP) queued
 * instead of collecting a "model busy" failure.
 */
export async function withNoStream<T>(
  fn: () => Promise<T>,
  timeoutMs = 300
): Promise<T> {
  if (activeOwner === null) return fn();

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(wake);
      resolve();
    }, timeoutMs);
    const wake = () => {
      clearTimeout(timer);
      waiters.delete(wake);
      resolve();
    };
    waiters.add(wake);
  });
  if (activeOwner !== null) {
    throw new Error(`ASR model busy: stream active (owned by ${activeOwner})`);
  }

  return fn();
}

/** Only for tests: forget any owner. */
export function resetAsrGateForTests(): void {
  activeOwner = null;
  for (const wake of [...waiters]) wake();
  waiters.clear();
}
