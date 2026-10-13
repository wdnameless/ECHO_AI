import { invoke, Channel } from "@tauri-apps/api/core";
import type { StreamingSTTSession } from "./stt/streaming";

/**
 * The pluely-asr sidecar accepts ONE active stream per model: a second one is
 * refused with `stream begin failed: model busy (active streams: 1)`.
 *
 * For native streaming in Tauri, the stream owner and PCM frames are handled
 * directly by Rust (`src-tauri/src/asr_stream.rs`), bypassing the JS WebSocket hop.
 */

export type AsrStreamOwner = "me" | "them";
export const ASR_MODEL_BUSY_CODE = "ASR_MODEL_BUSY";

export function isTauriEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/** Thrown when the gate timeout expires while a stream holds the model. Retryable, never a hard failure. */
export class AsrModelBusyError extends Error {
  code: typeof ASR_MODEL_BUSY_CODE;
  activeOwner: AsrStreamOwner;
  owner: AsrStreamOwner;
  retryable: boolean;

  constructor(activeOwner: AsrStreamOwner) {
    super(`ASR model busy: stream held by "${activeOwner}"`);
    this.name = "AsrModelBusyError";
    this.code = ASR_MODEL_BUSY_CODE;
    this.activeOwner = activeOwner;
    this.owner = activeOwner;
    this.retryable = true;
  }
}

export function isAsrModelBusyError(err: unknown): err is AsrModelBusyError {
  return err instanceof AsrModelBusyError;
}

let activeOwner: AsrStreamOwner | null = null;
let httpActiveCount = 0;
const waiters = new Set<() => void>();

let releaseInProgress: Promise<void> | null = null;
export interface SlotQueueRequest {
  owner: AsrStreamOwner;
  callback: () => boolean | void;
}

const slotQueue: SlotQueueRequest[] = [];

/** Returns how many channel requests are currently queued for the slot. */
export function getSlotQueueLength(): number {
  return slotQueue.length;
}

/** Returns the active in-memory owner of the stream slot. */
export function getActiveStreamOwner(): AsrStreamOwner | null {
  return activeOwner;
}


/** True when a stream may be opened for this owner right now. */
export function tryAcquireStream(owner: AsrStreamOwner): boolean {
  if (httpActiveCount > 0) return false;
  if (releaseInProgress !== null) return false;
  if (activeOwner !== null && activeOwner !== owner) return false;
  activeOwner = owner;

  if (isTauriEnvironment()) {
    void invoke("asr_native_try_acquire", { owner }).catch(() => {});
  }

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
    if (claimed) {
      if (isTauriEnvironment()) {
        void invoke("asr_native_try_acquire", { owner: next.owner }).catch(() => {});
      }
      return;
    }
    if (activeOwner === next.owner) {
      activeOwner = null;
      if (isTauriEnvironment()) {
        void invoke("asr_native_release", { owner: next.owner }).catch(() => {});
      }
    }
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

export async function releaseStream(owner: AsrStreamOwner): Promise<void> {
  if (activeOwner !== owner) return;
  activeOwner = null;

  if (isTauriEnvironment()) {
    const p = invoke("asr_native_release", { owner })
      .catch(() => {})
      .then(() => {});
    releaseInProgress = p;
    try {
      await p;
    } finally {
      if (releaseInProgress === p) {
        releaseInProgress = null;
      }
    }
  }

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
  releaseInProgress = null;
  slotQueue.length = 0;
  for (const wake of [...waiters]) wake();
  waiters.clear();
  httpActiveCount = 0;
  activeCloudSession = null;
  activeCloudProviderId = null;

  if (isTauriEnvironment()) {
    void invoke("asr_native_reset").catch(() => {});
  }
}

/** S2: Cloud STT streaming slot alongside local WS. */
let activeCloudSession: StreamingSTTSession | null = null;
let activeCloudProviderId: string | null = null;

export function acquireCloudStreamSlot(
  providerId: string,
  session: StreamingSTTSession
): boolean {
  if (activeCloudSession) return false;
  activeCloudSession = session;
  activeCloudProviderId = providerId;
  return true;
}

export function releaseCloudStreamSlot(): void {
  if (activeCloudSession) {
    try {
      activeCloudSession.close();
    } catch {
      // ignore
    }
  }
  activeCloudSession = null;
  activeCloudProviderId = null;
}

export function getActiveCloudStreamSlot(): {
  providerId: string;
  session: StreamingSTTSession;
} | null {
  if (!activeCloudSession || !activeCloudProviderId) return null;
  return { providerId: activeCloudProviderId, session: activeCloudSession };
}

export interface AsrSocketLike {
  readonly readyState: number;
  binaryType: string;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

class NativeAsrSocket implements AsrSocketLike {
  public readyState: number = 0; // CONNECTING
  public binaryType: string = "arraybuffer";
  public onopen: ((ev: Event) => void) | null = null;
  public onmessage: ((ev: MessageEvent) => void) | null = null;
  public onclose: ((ev: CloseEvent) => void) | null = null;
  public onerror: ((ev: Event) => void) | null = null;

  private streamId: string;
  private isClosed = false;

  constructor(url: string, owner?: AsrStreamOwner) {
    this.streamId = `asr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const channel = new Channel<string>();

    channel.onmessage = (msg: string) => {
      if (this.isClosed) return;
      if (typeof msg === "string" && msg.includes("\"__closed__\"")) {
        this.handleRemoteClose();
        return;
      }
      if (typeof msg === "string" && msg.includes("\"__error__\"")) {
        this.onerror?.(new Event("error"));
        this.handleRemoteClose();
        return;
      }
      this.onmessage?.(new MessageEvent("message", { data: msg }));
    };

    invoke("asr_native_connect", {
      streamId: this.streamId,
      url,
      onEvent: channel,
      owner,
    })
      .then(() => {
        if (this.isClosed) {
          void invoke("asr_native_close", { streamId: this.streamId });
          return;
        }
        this.readyState = 1; // OPEN
        this.onopen?.(new Event("open"));
      })
      .catch((_err: unknown) => {
        if (this.isClosed) return;
        this.readyState = 3; // CLOSED
        this.onerror?.(new Event("error"));
        this.onclose?.(new CloseEvent("close", { wasClean: false }));
      });
  }

  public send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.isClosed || this.readyState !== 1) return;
    if (typeof data === "string") {
      void invoke("asr_native_send", {
        streamId: this.streamId,
        text: data,
      }).catch(console.warn);
    } else if (data instanceof ArrayBuffer) {
      void invoke("asr_native_send", {
        streamId: this.streamId,
        pcmBytes: new Uint8Array(data),
      }).catch(console.warn);
    } else if (ArrayBuffer.isView(data)) {
      void invoke("asr_native_send", {
        streamId: this.streamId,
        pcmBytes: new Uint8Array(
          data.buffer,
          data.byteOffset,
          data.byteLength
        ),
      }).catch(console.warn);
    }
  }

  public close(_code?: number, _reason?: string): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.readyState = 2; // CLOSING
    void invoke("asr_native_close", { streamId: this.streamId }).finally(() => {
      this.readyState = 3; // CLOSED
      this.onclose?.(new CloseEvent("close", { wasClean: true }));
    });
  }

  private handleRemoteClose(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.readyState = 3; // CLOSED
    this.onclose?.(new CloseEvent("close", { wasClean: false }));
  }
}

/**
 * Creates an ASR streaming connection.
 * When in Tauri WebView, uses native tokio-tungstenite client (`asr_native_*`)
 * so PCM audio flows directly from Rust to sidecar without JS WebSocket hop.
 * In non-Tauri / test environments, creates a standard WebSocket.
 */
export function createAsrSocket(
  url: string,
  owner?: AsrStreamOwner
): WebSocket | AsrSocketLike {
  if (isTauriEnvironment()) {
    return new NativeAsrSocket(url, owner);
  }
  return new WebSocket(url);
}
