import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { restoreSelfEvolution } from "../self-evolution-persist";
import {
  getFeedbackLog,
  getUserStylePreferences,
  saveFeedbackLog,
  saveUserStylePreferences,
} from "@/lib/storage/user-facts";

const mockExecute = vi.fn();
const mockSelect = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/database/config", () => ({
  getDatabase: vi.fn().mockImplementation(() =>
    Promise.resolve({
      execute: mockExecute,
      select: mockSelect,
    })
  ),
}));

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: Record<string, unknown>;
}

describe("restoreSelfEvolution bridge (R04)", () => {
  const tWindow = window as unknown as TauriWindow;

  beforeEach(() => {
    vi.clearAllMocks();
    saveFeedbackLog([]);
    saveUserStylePreferences({
      tone: "default",
      preferredLength: "concise",
      favoritePatterns: [],
      avoidPatterns: [],
      customRules: [],
    });
    mockExecute.mockResolvedValue({ rowsAffected: 1 });
    mockSelect.mockResolvedValue([]);
    tWindow.__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete tWindow.__TAURI_INTERNALS__;
    saveFeedbackLog([]);
  });

  it("restores feedback and style preferences via Rust invoke under Tauri without db.select", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "db_get_se_feedback") {
        return Promise.resolve([
          {
            id: "fb-1",
            question: "How do I test?",
            response: "Write tests first.",
            rating: "like",
            reason: "Helpful",
            topic: "TDD",
            timestamp: 5000,
          },
        ]);
      }
      if (cmd === "db_get_se_style") {
        return Promise.resolve({
          tone: "direct and focused",
          preferredLength: "concise",
          favoritePatterns: ["pattern-a"],
          avoidPatterns: ["pattern-b"],
          customRules: ["rule-c"],
        });
      }
      return Promise.resolve(undefined);
    });

    await restoreSelfEvolution();

    // Invariant: routed through typed Rust commands
    expect(invokeMock).toHaveBeenCalledWith("db_get_se_feedback", {
      limit: 10000,
    });
    expect(invokeMock).toHaveBeenCalledWith("db_get_se_style");

    // Invariant: direct DB select was NOT called in Tauri WebView
    expect(mockSelect).not.toHaveBeenCalled();

    // Verify feedback restored in localStorage
    const feedback = getFeedbackLog();
    expect(feedback).toHaveLength(1);
    expect(feedback[0].id).toBe("fb-1");
    expect(feedback[0].rating).toBe("like");

    // Verify style restored in localStorage
    const style = getUserStylePreferences();
    expect(style.tone).toBe("direct and focused");
    expect(style.favoritePatterns).toEqual(["pattern-a"]);
    expect(style.avoidPatterns).toEqual(["pattern-b"]);
    expect(style.customRules).toEqual(["rule-c"]);
  });

  it("falls back to db.select in non-Tauri mode", async () => {
    delete tWindow.__TAURI_INTERNALS__;
    const invokeMock = vi.mocked(invoke);

    mockSelect.mockImplementation((query: string) => {
      if (query.includes("se_feedback_log")) {
        return Promise.resolve([
          {
            id: "fb-legacy",
            question: "Legacy question",
            response: "Legacy answer",
            rating: "dislike",
            reason: null,
            topic: null,
            timestamp: 3000,
          },
        ]);
      }
      if (query.includes("se_style")) {
        return Promise.resolve([
          {
            tone: "calm",
            preferred_length: "balanced",
            favorite_patterns: JSON.stringify(["fav-1"]),
            avoid_patterns: JSON.stringify([]),
            custom_rules: JSON.stringify([]),
          },
        ]);
      }
      return Promise.resolve([]);
    });

    await restoreSelfEvolution();

    // Invariant: invoke was NOT called in non-Tauri environment
    expect(invokeMock).not.toHaveBeenCalled();

    // Invariant: fallback queried via SQLite plugin
    expect(mockSelect).toHaveBeenCalled();

    // Verify state restored via fallback
    const feedback = getFeedbackLog();
    expect(feedback).toHaveLength(1);
    expect(feedback[0].id).toBe("fb-legacy");

    const style = getUserStylePreferences();
    expect(style.tone).toBe("calm");
    expect(style.favoritePatterns).toEqual(["fav-1"]);
  });
});
