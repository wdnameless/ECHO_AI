import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FillerManager } from "@/lib/filler-manager";

describe("FillerManager", () => {
  let manager: FillerManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new FillerManager({
      latencyThresholdMs: 1500,
      audioPlaybackEnabled: false, // Disable audio for pure logic tests
    });
  });

  afterEach(() => {
    manager.destroy();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not trigger filler before 1500ms latency", () => {
    const listener = vi.fn();
    manager.subscribe(listener);

    manager.startMonitoring();

    vi.advanceTimersByTime(1400);

    expect(manager.getState().activeFiller).toBeNull();
    expect(manager.getState().status).toBe("monitoring");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ status: "monitoring", activeFiller: null })
    );
  });

  it("triggers random filler playback when latency exceeds 1.5s", () => {
    const listener = vi.fn();
    manager.subscribe(listener);

    manager.startMonitoring();

    vi.advanceTimersByTime(1550);

    const state = manager.getState();
    expect(state.status).toBe("playing");
    expect(state.activeFiller).toBeTruthy();
    expect(typeof state.activeFiller).toBe("string");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "playing",
        activeFiller: expect.any(String),
      })
    );
  });

  it("stops instantly when new text starts streaming", () => {
    manager.startMonitoring();

    // Trigger filler at > 1.5s
    vi.advanceTimersByTime(1600);
    expect(manager.getState().status).toBe("playing");
    expect(manager.getState().activeFiller).toBeTruthy();

    // LLM starts streaming first chunk
    manager.stop();

    expect(manager.getState().status).toBe("idle");
    expect(manager.getState().activeFiller).toBeNull();
    expect(manager.getState().isPlaying).toBe(false);
  });

  it("cancels monitoring without playing if LLM responds within 1.5s", () => {
    manager.startMonitoring();

    vi.advanceTimersByTime(800);
    manager.stop();

    vi.advanceTimersByTime(1000);

    expect(manager.getState().status).toBe("idle");
    expect(manager.getState().activeFiller).toBeNull();
  });

  it("rotates fillers while waiting if latency extends further", () => {
    manager.startMonitoring();

    // Wait until triggered
    vi.advanceTimersByTime(1600);
    const firstFiller = manager.getState().activeFiller;
    expect(firstFiller).toBeTruthy();

    // Advance by rotation interval (4000ms)
    vi.advanceTimersByTime(4000);
    expect(manager.getState().activeFiller).toBeTruthy();
  });
});
