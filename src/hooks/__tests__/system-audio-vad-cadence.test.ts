import { describe, it, expect } from "vitest";
import {
  FLUSH_SAFETY_TIMEOUT_MS,
  decodeSpeechFramePayload,
} from "../useSystemAudioCapture";

describe("T5 (R05) System audio safety timer and binary IPC decode", () => {
  it("safety timeout is 350ms instead of 1200ms", () => {
    expect(FLUSH_SAFETY_TIMEOUT_MS).toBe(350);
  });

  describe("decodeSpeechFramePayload", () => {
    it("handles binary Uint8Array directly", () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const decoded = decodeSpeechFramePayload(bytes);
      expect(decoded).toEqual(bytes);
    });

    it("handles binary ArrayBuffer", () => {
      const buffer = new Uint8Array([10, 20, 30]).buffer;
      const decoded = decodeSpeechFramePayload(buffer);
      expect(decoded).toEqual(new Uint8Array([10, 20, 30]));
    });

    it("handles binary IPC Vec<u8> serialized as number[]", () => {
      const raw = [5, 6, 7, 8];
      const decoded = decodeSpeechFramePayload(raw);
      expect(decoded).toBeInstanceOf(Uint8Array);
      expect(decoded).toEqual(new Uint8Array([5, 6, 7, 8]));
    });

    it("handles legacy base64 string fallback", () => {
      const original = new Uint8Array([65, 66, 67, 68]); // "ABCD"
      const b64 = btoa("ABCD");
      const decoded = decodeSpeechFramePayload(b64);
      expect(decoded).toEqual(original);
    });

    it("returns null on null or undefined or invalid payload", () => {
      expect(decodeSpeechFramePayload(null)).toBeNull();
      expect(decodeSpeechFramePayload(undefined)).toBeNull();
      expect(decodeSpeechFramePayload(123)).toBeNull();
    });
  });
});
