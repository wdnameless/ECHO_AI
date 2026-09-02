import { describe, it, expect, beforeEach } from "vitest";
import {
  calculateRetentionCutoff,
  isRetentionExpired,
  getRetentionDays,
  setRetentionDays,
  DEFAULT_RETENTION_DAYS,
} from "../retention";

describe("retention module", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("calculateRetentionCutoff", () => {
    it("returns null when retention days is 0 (keep forever)", () => {
      const cutoff = calculateRetentionCutoff(0);
      expect(cutoff).toBeNull();
    });

    it("returns null when retention days is negative", () => {
      const cutoff = calculateRetentionCutoff(-5);
      expect(cutoff).toBeNull();
    });

    it("calculates exact cutoff timestamp for N days in past", () => {
      const now = 1_700_000_000_000;
      const days = 30;
      const expectedCutoff = now - 30 * 24 * 60 * 60 * 1000;

      const cutoff = calculateRetentionCutoff(days, now);
      expect(cutoff).toBe(expectedCutoff);
    });

    it("uses Date.now() when now timestamp is omitted", () => {
      const before = Date.now();
      const cutoff = calculateRetentionCutoff(7);
      const after = Date.now();

      expect(cutoff).not.toBeNull();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(cutoff!).toBeGreaterThanOrEqual(before - sevenDaysMs);
      expect(cutoff!).toBeLessThanOrEqual(after - sevenDaysMs);
    });
  });

  describe("isRetentionExpired", () => {
    it("returns false if cutoffMs is null", () => {
      const updatedAt = 1000;
      expect(isRetentionExpired(updatedAt, null)).toBe(false);
    });

    it("returns true if record updatedAt is strictly less than cutoff", () => {
      const cutoff = 5000;
      expect(isRetentionExpired(4999, cutoff)).toBe(true);
      expect(isRetentionExpired(1000, cutoff)).toBe(true);
    });

    it("returns false if record updatedAt is greater than or equal to cutoff", () => {
      const cutoff = 5000;
      expect(isRetentionExpired(5000, cutoff)).toBe(false);
      expect(isRetentionExpired(5001, cutoff)).toBe(false);
    });
  });

  describe("getRetentionDays and setRetentionDays", () => {
    it("returns default retention days (30) when storage is empty", async () => {
      const days = await getRetentionDays();
      expect(days).toBe(DEFAULT_RETENTION_DAYS);
      expect(days).toBe(30);
    });

    it("persists and retrieves updated retention days", async () => {
      await setRetentionDays(60);
      const days = await getRetentionDays();
      expect(days).toBe(60);
    });

    it("handles 0 days (keep forever)", async () => {
      await setRetentionDays(0);
      const days = await getRetentionDays();
      expect(days).toBe(0);
    });

    it("clamps negative retention days to 0", async () => {
      await setRetentionDays(-10);
      const days = await getRetentionDays();
      expect(days).toBe(0);
    });
  });
});
