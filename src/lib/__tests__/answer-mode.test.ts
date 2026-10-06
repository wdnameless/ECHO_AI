import { describe, it, expect, beforeEach, vi } from "vitest";
import { getAnswerMode, setAnswerMode } from "../answer-mode";
import { safeLocalStorage } from "../storage/helper";

describe("AnswerMode store", () => {
  beforeEach(() => {
    safeLocalStorage.removeItem("answer_mode");
  });

  it("defaults to interview mode when nothing is stored", () => {
    expect(getAnswerMode()).toBe("interview");
  });

  it("persists and reads thought mode", () => {
    setAnswerMode("thought");
    expect(getAnswerMode()).toBe("thought");
  });

  it("persists and reads livecode mode", () => {
    setAnswerMode("livecode");
    expect(getAnswerMode()).toBe("livecode");
  });

  it("falls back to interview mode on unrecognized or corrupt values", () => {
    safeLocalStorage.setItem("answer_mode", "unexpected_mode");
    expect(getAnswerMode()).toBe("interview");
  });

  it("dispatches window event on mode change", () => {
    const handler = vi.fn();
    window.addEventListener("answer-mode-changed", handler);

    setAnswerMode("thought");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toBe("thought");

    window.removeEventListener("answer-mode-changed", handler);
  });
});
