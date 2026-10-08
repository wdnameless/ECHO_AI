import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWarmup } from "../useWarmup";
import { invoke } from "@tauri-apps/api/core";
import { getRagContext } from "@/lib/rag/context.storage";
import { warmProviderConnection } from "@/lib/host-trust-gate";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/rag/context.storage", () => ({
  getRagContext: vi.fn(),
}));

vi.mock("@/lib/host-trust-gate", () => ({
  warmProviderConnection: vi.fn(),
}));

describe("useWarmup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "start_handy_server") return undefined;
      if (cmd === "handy_server_status_detailed") return { online: true };
      return undefined;
    });
    vi.mocked(getRagContext).mockResolvedValue("mock-context");
    vi.mocked(warmProviderConnection).mockResolvedValue(undefined);
  });

  it("warms engine, provider, and RAG automatically at session start (mount)", async () => {
    const { result } = renderHook(() =>
      useWarmup({
        providerUrl: "https://api.openai.com/v1",
        modelKey: "large-v3",
        autoWarmOnMount: true,
      })
    );

    // Initial state before warm resolves or while running
    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith("start_handy_server");
    expect(invoke).toHaveBeenCalledWith("handy_server_status_detailed");
    expect(warmProviderConnection).toHaveBeenCalledWith("https://api.openai.com/v1");
    expect(getRagContext).toHaveBeenCalledWith("resume");
    expect(getRagContext).toHaveBeenCalledWith("job");

    expect(result.current.state).toBe("done");
    expect(result.current.visible).toBe(false);
  });

  it("supports manual re-warming via warm()", async () => {
    const { result } = renderHook(() =>
      useWarmup({
        providerUrl: "https://api.openai.com/v1",
        modelKey: "large-v3",
        autoWarmOnMount: false,
      })
    );

    expect(result.current.state).toBe("idle");
    expect(result.current.visible).toBe(true);

    let res;
    await act(async () => {
      res = await result.current.warm();
    });

    expect(res).toEqual({
      engineOnline: true,
      providerWarmed: true,
      ragCached: { resume: true, job: true },
    });
    expect(result.current.state).toBe("done");
  });
});
