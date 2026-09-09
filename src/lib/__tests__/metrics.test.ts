import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getMetrics,
  recordTtft,
  recordSttDuration,
  recordWsReconnect,
  recordLostSegment,
  resetMetrics,
  onMetrics,
} from "../metrics";

describe("metrics module", () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe("initial state", () => {
    it("returns null/0 values for default metrics", () => {
      const m = getMetrics();
      expect(m.lastTtftMs).toBeNull();
      expect(m.avgTtftMs).toBeNull();
      expect(m.ttftSamplesCount).toBe(0);
      expect(m.wsReconnectCount).toBe(0);
      expect(m.lostSegmentsCount).toBe(0);
      expect(m.lastSttDurationMs).toBeNull();
      expect(m.avgSttDurationMs).toBeNull();
      expect(m.sttSamplesCount).toBe(0);
    });
  });

  describe("TTFT calculation", () => {
    it("records single TTFT value", () => {
      recordTtft(350);
      const m = getMetrics();
      expect(m.lastTtftMs).toBe(350);
      expect(m.avgTtftMs).toBe(350);
      expect(m.ttftSamplesCount).toBe(1);
    });

    it("calculates moving average correctly across multiple samples", () => {
      recordTtft(200);
      recordTtft(400);
      recordTtft(600);
      const m = getMetrics();
      expect(m.lastTtftMs).toBe(600);
      expect(m.avgTtftMs).toBe(400);
      expect(m.ttftSamplesCount).toBe(3);
    });

    it("ignores invalid TTFT values", () => {
      recordTtft(500);
      recordTtft(-100);
      recordTtft(NaN);
      const m = getMetrics();
      expect(m.lastTtftMs).toBe(500);
      expect(m.avgTtftMs).toBe(500);
      expect(m.ttftSamplesCount).toBe(1);
    });
  });

  describe("STT duration calculation", () => {
    it("records single and averaged STT durations", () => {
      recordSttDuration(120);
      recordSttDuration(180);
      const m = getMetrics();
      expect(m.lastSttDurationMs).toBe(180);
      expect(m.avgSttDurationMs).toBe(150);
      expect(m.sttSamplesCount).toBe(2);
    });

    it("ignores negative/NaN STT values", () => {
      recordSttDuration(-50);
      recordSttDuration(NaN);
      const m = getMetrics();
      expect(m.lastSttDurationMs).toBeNull();
      expect(m.sttSamplesCount).toBe(0);
    });
  });

  describe("counters", () => {
    it("increments wsReconnectCount", () => {
      recordWsReconnect();
      recordWsReconnect(2);
      expect(getMetrics().wsReconnectCount).toBe(3);
    });

    it("throttles lostSegmentsCount to one increment per second", () => {
      vi.useFakeTimers();
      recordLostSegment();
      // Calls within the same second are dropped (frame-level noise).
      recordLostSegment(4);
      vi.advanceTimersByTime(50);
      recordLostSegment();
      expect(getMetrics().lostSegmentsCount).toBe(1);
      // After the throttle window a new window is counted.
      vi.advanceTimersByTime(1000);
      recordLostSegment();
      expect(getMetrics().lostSegmentsCount).toBe(2);
      vi.useRealTimers();
    });
  });

  describe("pub/sub listeners", () => {
    it("notifies listeners on metric change", () => {
      let notifiedCount = 0;
      let latestTtft: number | null = null;

      const unsubscribe = onMetrics((m) => {
        notifiedCount++;
        latestTtft = m.lastTtftMs;
      });

      // Initial call on subscription
      expect(notifiedCount).toBe(1);
      expect(latestTtft).toBeNull();

      recordTtft(250);
      expect(notifiedCount).toBe(2);
      expect(latestTtft).toBe(250);

      unsubscribe();
      recordTtft(800);
      expect(notifiedCount).toBe(2);
    });
  });
});
