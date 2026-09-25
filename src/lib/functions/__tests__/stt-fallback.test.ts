import { describe, it, expect, vi } from "vitest";

const fetchSTTMock = vi.fn();
vi.mock("../stt.function", () => ({
  fetchSTT: (...args: unknown[]) => fetchSTTMock(...args),
  isSttErrorMessage: (text: string | null | undefined) =>
    !!text && text.trim().toLowerCase().startsWith("[stt error:"),
}));

vi.mock("../pluely.api", () => ({
  shouldUsePluelyAPI: async () => false,
}));

import { transcribeWithFallback } from "../stt-fallback";

describe("transcribeWithFallback", () => {
  it("does not discard speech mentioning HTTP status codes (e.g. HTTP 404)", async () => {
    fetchSTTMock.mockResolvedValue("User said HTTP 404 Not Found");
    const result = await transcribeWithFallback({
      selectedProvider: { provider: "handy", variables: {} },
      audio: new Blob([]),
    });
    expect(result).toBe("User said HTTP 404 Not Found");
  });

  it("throws clear error when STT error message is returned", async () => {
    fetchSTTMock.mockResolvedValue("[STT error: failed]");
    await expect(
      transcribeWithFallback({
        selectedProvider: { provider: "handy", variables: {} },
        audio: new Blob([]),
      })
    ).rejects.toThrow("Локальный движок распознавания не отвечает");
  });

  it("throws clear error on Network error prefix", async () => {
    fetchSTTMock.mockResolvedValue("Network error: connection refused");
    await expect(
      transcribeWithFallback({
        selectedProvider: { provider: "handy", variables: {} },
        audio: new Blob([]),
      })
    ).rejects.toThrow("Локальный движок распознавания не отвечает");
  });
});
