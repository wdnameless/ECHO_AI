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

export interface SlotQueueRequest {
  owner: AsrStreamOwner;
  callback: () => void;
}

const slotQueue: SlotQueueRequest[] = [];

/** Returns how many channel requests are currently queued for the slot. */
export function getSlotQueueLength(): number {
  return slotQueue.length;
}

/** True when a stream may be opened for this owner right now. */
export function tryAcquireStream(owner: AsrStreamOwner): boolean {
  if (activeOwner !== null && activeOwner !== owner) return false;
  activeOwner = owner;
  return true;
}

/**
 * Enqueues a channel for the ASR slot.
 *
 * If the slot is free right now, claims it and invokes callback immediately.
 * Otherwise, queues the request in FIFO order so it is notified the moment
 * the active owner calls releaseStream, eliminating backoff race delay.
 *
 * Returns an unsubscription callback to cancel waiting if the channel stops.
 */
export function enqueueStreamSlot(
  owner: AsrStreamOwner,
  callback: () => void
): () => void {
  if (tryAcquireStream(owner)) {
    callback();
    return () => {};
  }

  const request: SlotQueueRequest = { owner, callback };
  slotQueue.push(request);

  return () => {
    const index = slotQueue.indexOf(request);
    if (index !== -1) {
      slotQueue.splice(index, 1);
    }
  };
}

/** Cancels pending slot queue requests for the specified owner, or all if omitted. */
export function cancelSlotQueue(owner?: AsrStreamOwner): void {
  if (!owner) {
    slotQueue.length = 0;
    return;
  }
  for (let i = slotQueue.length - 1; i >= 0; i--) {
    if (slotQueue[i].owner === owner) {
      slotQueue.splice(i, 1);
    }
  }
}

/**
 * Waits until the ASR slot can be acquired by this owner, or times out.
 */
export function waitForStreamSlot(
  owner: AsrStreamOwner,
  timeoutMs = 3000
): Promise<boolean> {
  if (tryAcquireStream(owner)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let timer: NodeJS.Timeout | number | null = null;
    const cancel = enqueueStreamSlot(owner, () => {
      clearTimeout(timer!);
      resolve(true);
    });
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        cancel();
        resolve(false);
      }, timeoutMs);
    }
  });
}

export function releaseStream(owner: AsrStreamOwner): void {
  if (activeOwner !== owner) return;
  activeOwner = null;

  // Hand off slot directly to the next waiting channel in FIFO queue
  while (slotQueue.length > 0) {
    const next = slotQueue.shift();
    if (next) {
      activeOwner = next.owner;
      next.callback();
      return;
    }
  }

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

/** Only for tests: forget any owner and clear queued requests. */
export function resetAsrGateForTests(): void {
  activeOwner = null;
  slotQueue.length = 0;
  for (const wake of [...waiters]) wake();
  waiters.clear();
}
