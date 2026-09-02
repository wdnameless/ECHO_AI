import { describe, it, expect, beforeEach, vi } from "vitest";
import { micStateStore } from "./mic-state";

describe("micStateStore", () => {
  beforeEach(() => {
    micStateStore.setMode("IDLE");
  });

  it("initializes with IDLE mode", () => {
    expect(micStateStore.getState().mode).toBe("IDLE");
  });

  it("transitions between modes correctly", () => {
    micStateStore.setMode("DICTATION");
    expect(micStateStore.getState().mode).toBe("DICTATION");

    micStateStore.setMode("ASSISTANT");
    expect(micStateStore.getState().mode).toBe("ASSISTANT");

    micStateStore.setMode("IDLE");
    expect(micStateStore.getState().mode).toBe("IDLE");
  });

  it("enforces mutual exclusivity: switching mode changes previous active mode", () => {
    micStateStore.setMode("DICTATION");
    expect(micStateStore.isDictation()).toBe(true);
    expect(micStateStore.isAssistant()).toBe(false);

    micStateStore.setMode("ASSISTANT");
    expect(micStateStore.isDictation()).toBe(false);
    expect(micStateStore.isAssistant()).toBe(true);

    micStateStore.setMode("IDLE");
    expect(micStateStore.isDictation()).toBe(false);
    expect(micStateStore.isAssistant()).toBe(false);
  });

  it("notifies subscribers when mode changes", () => {
    const listener = vi.fn();
    const unsubscribe = micStateStore.subscribe(listener);
    // Initial synchronous call on subscribe
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ mode: "IDLE" }));

    listener.mockClear();
    micStateStore.setMode("DICTATION");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "DICTATION", previousMode: "IDLE" })
    );

    listener.mockClear();
    micStateStore.setMode("ASSISTANT");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "ASSISTANT", previousMode: "DICTATION" })
    );

    unsubscribe();
    listener.mockClear();
    micStateStore.setMode("IDLE");
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not notify if setting same mode", () => {
    const listener = vi.fn();
    micStateStore.subscribe(listener);
    // initial sync call
    expect(listener).toHaveBeenCalledTimes(1);

    listener.mockClear();
    micStateStore.setMode("IDLE");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("Audio Routing Isolation", () => {
  beforeEach(() => {
    micStateStore.setMode("IDLE");
  });

  it("DICTATION mode routes segments to live feed and does NOT route to AI prompt", () => {
    micStateStore.setMode("DICTATION");

    const liveFeed: string[] = [];
    const aiPrompt: string[] = [];

    const handleTranscript = (speaker: "me" | "them", text: string) => {
      const mode = micStateStore.getState().mode;
      if (mode === "DICTATION") {
        liveFeed.push(`[${speaker}]: ${text}`);
      } else if (mode === "ASSISTANT" && speaker === "me") {
        aiPrompt.push(text);
      }
    };

    handleTranscript("me", "Hello interviewing team");
    expect(liveFeed).toEqual(["[me]: Hello interviewing team"]);
    expect(aiPrompt).toEqual([]);
  });

  it("ASSISTANT mode routes mic phrases to AI prompt and does NOT write to live feed", () => {
    micStateStore.setMode("ASSISTANT");

    const liveFeed: string[] = [];
    const aiPrompt: string[] = [];

    const handleTranscript = (speaker: "me" | "them", text: string) => {
      const mode = micStateStore.getState().mode;
      if (mode === "DICTATION") {
        liveFeed.push(`[${speaker}]: ${text}`);
      } else if (mode === "ASSISTANT" && speaker === "me") {
        aiPrompt.push(text);
      }
    };

    handleTranscript("me", "How do I implement binary search?");
    expect(liveFeed).toEqual([]);
    expect(aiPrompt).toEqual(["How do I implement binary search?"]);
  });

  it("IDLE mode ignores incoming mic chunks from routing to either target", () => {
    micStateStore.setMode("IDLE");

    const liveFeed: string[] = [];
    const aiPrompt: string[] = [];

    const handleTranscript = (speaker: "me" | "them", text: string) => {
      const mode = micStateStore.getState().mode;
      if (mode === "DICTATION") {
        liveFeed.push(`[${speaker}]: ${text}`);
      } else if (mode === "ASSISTANT" && speaker === "me") {
        aiPrompt.push(text);
      }
    };

    handleTranscript("me", "Background chatter");
    expect(liveFeed).toEqual([]);
    expect(aiPrompt).toEqual([]);
  });
});
