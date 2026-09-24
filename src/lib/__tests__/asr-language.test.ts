import { describe, it, expect, beforeEach } from "vitest";
import {
  ASR_LANGUAGE_STORAGE_KEY,
  DEFAULT_ASR_LANGUAGE,
  getAsrLanguage,
  setAsrLanguage,
} from "../asr-language";

describe("asr-language", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to auto detection so the recogniser is never pinned to the answer language", () => {
    expect(getAsrLanguage()).toBe(DEFAULT_ASR_LANGUAGE);
    expect(DEFAULT_ASR_LANGUAGE).toBe("auto");
  });

  it("round-trips an explicit choice", () => {
    setAsrLanguage("ru");
    expect(getAsrLanguage()).toBe("ru");
    setAsrLanguage("en");
    expect(getAsrLanguage()).toBe("en");
  });

  it("falls back to auto for an unknown stored value", () => {
    localStorage.setItem(ASR_LANGUAGE_STORAGE_KEY, "klingon");
    expect(getAsrLanguage()).toBe("auto");
  });
});
