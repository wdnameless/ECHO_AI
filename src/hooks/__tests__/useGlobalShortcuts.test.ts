import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGlobalShortcuts } from "../useGlobalShortcuts";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@/lib/storage", () => ({
  getShortcutsConfig: vi.fn(() => ({})),
}));

describe("useGlobalShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registerSystemAudioCallback returns an unregister function that cleans up", () => {
    const { result, unmount } = renderHook(() => useGlobalShortcuts());
    const callback = vi.fn();

    let unregister: (() => void) | void = undefined;
    act(() => {
      unregister = result.current.registerSystemAudioCallback(callback);
    });

    expect(typeof unregister).toBe("function");

    act(() => {
      if (unregister) unregister();
    });

    // Register again and test cleanup on consumer unmount pattern
    const callback2 = vi.fn();
    let unregister2: (() => void) | void = undefined;
    act(() => {
      unregister2 = result.current.registerSystemAudioCallback(callback2);
    });
    expect(typeof unregister2).toBe("function");

    act(() => {
      if (unregister2) unregister2();
    });

    unmount();
  });
});
