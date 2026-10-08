import { describe, it, expect, vi } from "vitest";
import {
  nextReconnectDelay,
  closeSocketDetached,
  looksLikeStreamRefusal,
  enqueueStreamSlot,
  waitForStreamSlot,
} from "../asr-ws-shared";

/**
 * These primitives exist because the two ASR channels drifted: a fix landed in
 * one and was forgotten in the other, three times (socket ref at creation,
 * exponential backoff, the refusal detector). Pinning them here means the shared
 * behaviour is stated once — and a channel that stops using them fails its own
 * tests rather than silently diverging.
 */
describe("nextReconnectDelay", () => {
  const backoff = { baseMs: 400, maxMs: 3000 };

  it("grows exponentially from the base delay", () => {
    expect(nextReconnectDelay(0, backoff)).toBe(400);
    expect(nextReconnectDelay(1, backoff)).toBe(800);
    expect(nextReconnectDelay(2, backoff)).toBe(1600);
  });

  it("caps the delay instead of growing without bound", () => {
    // A flat retry hammered the engine while the other channel held the model.
    expect(nextReconnectDelay(3, backoff)).toBe(3000);
    expect(nextReconnectDelay(20, backoff)).toBe(3000);
  });
});

describe("closeSocketDetached", () => {
  const mkSocket = (readyState: number) => {
    const ws = {
      readyState,
      onclose: vi.fn(),
      onerror: vi.fn(),
      onmessage: vi.fn(),
      onopen: vi.fn(),
      close: vi.fn(),
    };
    return ws as unknown as WebSocket & typeof ws;
  };

  it("closes a CONNECTING socket", () => {
    // The exact leak: a handshake that finishes in the background held one of
    // the three engine sessions while the app believed it had stopped.
    const ws = mkSocket(0);
    closeSocketDetached(ws);
    expect(ws.close).toHaveBeenCalled();
  });

  it("closes an OPEN socket and detaches every handler first", () => {
    const ws = mkSocket(1);
    closeSocketDetached(ws);
    expect(ws.onclose).toBeNull();
    expect(ws.onerror).toBeNull();
    expect(ws.onmessage).toBeNull();
    expect(ws.onopen).toBeNull();
    expect(ws.close).toHaveBeenCalled();
  });

  it("does nothing for a socket that is already closed", () => {
    const ws = mkSocket(3);
    closeSocketDetached(ws);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("tolerates a null ref", () => {
    expect(() => closeSocketDetached(null)).not.toThrow();
  });
});

describe("looksLikeStreamRefusal", () => {
  it("reports a refusal when audio went out and nothing came back", () => {
    expect(
      looksLikeStreamRefusal({ stoppedByUs: false, framesSent: 10, producedText: false })
    ).toBe(true);
  });

  it("does NOT report a refusal on a deliberate close", () => {
    // A short sentence ends at ~0s while the model answers at ~1s, so this shape
    // is normal — recording it disabled streaming for the whole session.
    expect(
      looksLikeStreamRefusal({ stoppedByUs: true, framesSent: 10, producedText: false })
    ).toBe(false);
  });

  it("does not report a refusal when text came back", () => {
    expect(
      looksLikeStreamRefusal({ stoppedByUs: false, framesSent: 10, producedText: true })
    ).toBe(false);
  });

  it("does not report a refusal when no audio was sent", () => {
    expect(
      looksLikeStreamRefusal({ stoppedByUs: false, framesSent: 0, producedText: false })
    ).toBe(false);
  });
});

describe("slot queue shared re-exports", () => {
  it("exports slot queue coordination primitives", () => {
    expect(typeof enqueueStreamSlot).toBe("function");
    expect(typeof waitForStreamSlot).toBe("function");
  });
});
