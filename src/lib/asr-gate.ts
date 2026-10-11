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
export const ASR_MODEL_BUSY_CODE = "ASR_MODEL_BUSY";

/** Thrown when the gate timeout expires while a stream holds the model. Retryable, never a hard failure. */
export class AsrModelBusyError extends Error {
  readonly code = ASR_MODEL_BUSY_CODE;
  readonly retryable = true;
  readonly owner: AsrStreamOwner | null;
  constructor(owner: AsrStreamOwner | null) {
    super(`ASR model busy: stream active (owned by ${owner})`);
    this.name = "AsrModelBusyError";
    this.owner = owner;
  }
}

export function isAsrModelBusyError(err: unknown): err is AsrModelBusyError {
  return err instanceof AsrModelBusyError;
}

let activeOwner: AsrStreamOwner | null = null;
let httpActiveCount = 0;
const waiters = new Set<() => void>();
export interface SlotQueueRequest {
  owner: AsrStreamOwner;
  /** Return true to claim the slot; false releases it back to the queue. */
  callback: () => boolean | void;
}

const slotQueue: SlotQueueRequest[] = [];

/** Returns how many channel requests are currently queued for the slot. */
export function getSlotQueueLength(): number {
  return slotQueue.length;
}

/** True when a stream may be opened for this owner right now. */
export function tryAcquireStream(owner: AsrStreamOwner): boolean {
  if (httpActiveCount > 0) return false;
  if (activeOwner !== null && activeOwner !== owner) return false;
  activeOwner = owner;
  return true;
}

function handoffNextSlot(): void {
  if (activeOwner !== null || httpActiveCount > 0) return;
  while (slotQueue.length > 0) {
    const next = slotQueue.shift();
    if (!next) continue;
    activeOwner = next.owner;
    let claimed = false;
    try {
      claimed = next.callback() !== false;
    } catch {
      claimed = false;
    }
    // A declined handoff must not leak the slot: clear it and offer the
    // next waiter the model instead of deadlocking the gate forever.
    if (claimed) return;
    if (activeOwner === next.owner) activeOwner = null;
  }
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
  callback: () => boolean | void
): () => void {
  if (tryAcquireStream(owner)) {
    callback();
    return () => {};
  }

  // One pending request per owner: every reconnect tick while busy would
  // otherwise stack another duplicate entry for the same channel.
  const existing = slotQueue.find((request) => request.owner === owner);
  if (existing) {
    existing.callback = callback;
    return () => {
      const index = slotQueue.indexOf(existing);
      if (index !== -1) {
        slotQueue.splice(index, 1);
      }
    };
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

  // Hand off fairly: wake HTTP waiters first so withNoStream never starves.
  if (waiters.size > 0) {
    for (const wake of [...waiters]) wake();
    return;
  }

  handoffNextSlot();
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
  if (activeOwner === null) {
    httpActiveCount++;
  } else {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(wake);
        resolve();
      }, timeoutMs);
      const wake = () => {
        clearTimeout(timer);
        waiters.delete(wake);
        httpActiveCount++;
        resolve();
      };
      waiters.add(wake);
    });
    if (activeOwner !== null) {
      throw new AsrModelBusyError(activeOwner);
    }
  }

  try {
    return await fn();
  } finally {
    httpActiveCount--;
    if (httpActiveCount === 0 && waiters.size === 0) {
      handoffNextSlot();
    }
  }
}

/** Only for tests: forget any owner and clear queued requests. */
export function resetAsrGateForTests(): void {
  activeOwner = null;
  slotQueue.length = 0;
  for (const wake of [...waiters]) wake();
  waiters.clear();
  httpActiveCount = 0;
}
