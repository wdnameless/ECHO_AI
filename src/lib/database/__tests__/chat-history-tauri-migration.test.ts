import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { migrateLocalStorageToSQLite } from "../chat-history.action";
import { safeLocalStorage } from "@/lib";

const mockExecute = vi.fn();
const mockSelect = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../config", () => ({
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

describe("migrateLocalStorageToSQLite under Tauri (R04)", () => {
  const tWindow = window as unknown as TauriWindow;

  beforeEach(() => {
    vi.clearAllMocks();
    safeLocalStorage.removeItem("chat_history");
    safeLocalStorage.removeItem("chat_history_migrated_to_sqlite");
    mockExecute.mockResolvedValue({ rowsAffected: 1 });
    mockSelect.mockResolvedValue([]);
    tWindow.__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete tWindow.__TAURI_INTERNALS__;
    safeLocalStorage.removeItem("chat_history");
    safeLocalStorage.removeItem("chat_history_migrated_to_sqlite");
  });

  it("migrates localStorage chat history via Rust invoke commands without calling db.execute under Tauri", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "db_get_conversation_by_id") {
        return Promise.resolve(null);
      }
      if (cmd === "db_create_conversation") {
        return Promise.resolve({ id: "conv-1", title: "Test", messages: [] });
      }
      return Promise.resolve(undefined);
    });

    const data = [
      {
        id: "conv-1",
        title: "Test Conversation",
        createdAt: 1000,
        updatedAt: 2000,
        messages: [
          { id: "m-1", role: "user", content: "Hello", timestamp: 1100 },
          { id: "m-2", role: "assistant", content: "World", timestamp: 1200 },
        ],
      },
    ];

    safeLocalStorage.setItem("chat_history", JSON.stringify(data));

    const result = await migrateLocalStorageToSQLite();

    expect(result.success).toBe(true);
    expect(result.migratedCount).toBe(1);

    // Invariant: db.execute MUST NOT be called under Tauri (permission denied risk)
    expect(mockExecute).not.toHaveBeenCalled();

    // Invariant: routed through typed Rust commands
    expect(invokeMock).toHaveBeenCalledWith("db_get_conversation_by_id", {
      id: "conv-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("db_create_conversation", {
      conversation: expect.objectContaining({
        id: "conv-1",
        title: "Test Conversation",
        messages: expect.arrayContaining([
          expect.objectContaining({ id: "m-1", content: "Hello" }),
          expect.objectContaining({ id: "m-2", content: "World" }),
        ]),
      }),
    });

    // Invariant: source cleared and completed flag set
    expect(safeLocalStorage.getItem("chat_history")).toBeNull();
    expect(safeLocalStorage.getItem("chat_history_migrated_to_sqlite")).toBe("true");
  });

  it("handles Rust invoke error by rolling back via db_delete_conversation and preserving localStorage", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "db_get_conversation_by_id") {
        return Promise.resolve(null);
      }
      if (cmd === "db_create_conversation") {
        return Promise.reject(new Error("Rust DB lock failure"));
      }
      if (cmd === "db_delete_conversation") {
        return Promise.resolve(true);
      }
      return Promise.resolve(undefined);
    });

    const data = [
      {
        id: "conv-fail-1",
        title: "Failing Conversation",
        createdAt: 1000,
        updatedAt: 2000,
        messages: [{ id: "m-1", role: "user", content: "Hello", timestamp: 1100 }],
      },
    ];

    safeLocalStorage.setItem("chat_history", JSON.stringify(data));

    const result = await migrateLocalStorageToSQLite();

    expect(result.success).toBe(false);
    expect(result.migratedCount).toBe(0);

    // Invariant: db.execute was never touched
    expect(mockExecute).not.toHaveBeenCalled();

    // Invariant: attempted cleanup via Rust delete command
    expect(invokeMock).toHaveBeenCalledWith("db_delete_conversation", {
      id: "conv-fail-1",
    });

    // Invariant: source data preserved
    expect(safeLocalStorage.getItem("chat_history")).toBe(JSON.stringify(data));
    expect(safeLocalStorage.getItem("chat_history_migrated_to_sqlite")).toBeNull();
  });

  it("skips conversation if db_get_conversation_by_id indicates it already exists", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "db_get_conversation_by_id") {
        return Promise.resolve({ id: "conv-existing", title: "Existing", messages: [] });
      }
      return Promise.resolve(undefined);
    });

    const data = [
      {
        id: "conv-existing",
        title: "Existing Conversation",
        createdAt: 1000,
        updatedAt: 2000,
        messages: [],
      },
    ];

    safeLocalStorage.setItem("chat_history", JSON.stringify(data));

    const result = await migrateLocalStorageToSQLite();

    expect(result.success).toBe(true);
    expect(result.migratedCount).toBe(0);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "db_create_conversation",
      expect.anything()
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
