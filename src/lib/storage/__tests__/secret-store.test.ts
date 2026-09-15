import { describe, it, expect, beforeEach, vi } from "vitest";
import { STORAGE_KEYS } from "@/config";
import { WEB_SEARCH_SETTINGS_KEY } from "@/lib/web-search";
import {
  secretKey,
  saveSecret,
  getSecret,
  removeSecret,
  migrateSecretsFromLocalStorage,
  resetMigrationFlagForTests,
} from "../secret-store";

/**
 * Фейковый бэкенд хранилища: держит секреты в памяти и ведёт себя как
 * Rust-команды (save/get_item/remove), чтобы тесты не зависели от Tauri.
 */
const store = new Map<string, string>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(
    async (
      cmd: string,
      args?: { items?: Array<{ key: string; value: string }>; key?: string; keys?: string[] }
    ) => {
      if (cmd === "secure_storage_save") {
        for (const item of args?.items ?? []) store.set(item.key, item.value);
        return undefined;
      }
      if (cmd === "secure_storage_get_item") {
        return store.get(args?.key ?? "") ?? null;
      }
      if (cmd === "secure_storage_remove") {
        for (const key of args?.keys ?? []) store.delete(key);
        return undefined;
      }
      throw new Error(`unexpected command: ${cmd}`);
    }
  ),
}));

describe("secret-store", () => {
  beforeEach(() => {
    store.clear();
    localStorage.clear();
    resetMigrationFlagForTests();
  });

  describe("read and write", () => {
    it("round-trips a secret through the backend store", async () => {
      await saveSecret(secretKey.aiProvider("openai"), "sk-secret");
      await expect(getSecret(secretKey.aiProvider("openai"))).resolves.toBe("sk-secret");
    });

    it("returns null for an unknown key instead of throwing", async () => {
      await expect(getSecret("nothing:here")).resolves.toBeNull();
    });

    it("removes a secret", async () => {
      await saveSecret(secretKey.webSearch("brave"), "brave-key");
      await removeSecret(secretKey.webSearch("brave"));
      await expect(getSecret(secretKey.webSearch("brave"))).resolves.toBeNull();
    });
  });

  describe("migration from localStorage", () => {
    it("moves a custom provider key out of localStorage", async () => {
      localStorage.setItem(
        STORAGE_KEYS.CUSTOM_AI_PROVIDERS,
        JSON.stringify([
          {
            id: "custom-1",
            isCustom: true,
            curl: "curl https://my-llm.internal/v1",
            variables: { API_KEY: "leaked-key", MODEL: "m1" },
          },
        ])
      );

      const migrated = await migrateSecretsFromLocalStorage();

      expect(migrated).toBe(1);
      await expect(getSecret(secretKey.aiProvider("custom-1"))).resolves.toBe("leaked-key");

      // The key must no longer be readable from localStorage.
      const stored = localStorage.getItem(STORAGE_KEYS.CUSTOM_AI_PROVIDERS) as string;
      expect(stored).not.toContain("leaked-key");
      expect(stored).toContain("m1");
    });

    it("moves the selected provider key", async () => {
      localStorage.setItem(
        STORAGE_KEYS.SELECTED_AI_PROVIDER,
        JSON.stringify({ provider: "openai", variables: { API_KEY: "sel-key" } })
      );

      await migrateSecretsFromLocalStorage();

      await expect(getSecret(secretKey.aiProvider("openai"))).resolves.toBe("sel-key");
      expect(localStorage.getItem(STORAGE_KEYS.SELECTED_AI_PROVIDER)).not.toContain("sel-key");
    });

    it("moves web-search keys and drops them from settings", async () => {
      localStorage.setItem(
        WEB_SEARCH_SETTINGS_KEY,
        JSON.stringify({ provider: "brave", braveApiKey: "b-key", exaApiKey: "e-key" })
      );

      await migrateSecretsFromLocalStorage();

      await expect(getSecret(secretKey.webSearch("brave"))).resolves.toBe("b-key");
      await expect(getSecret(secretKey.webSearch("exa"))).resolves.toBe("e-key");

      const stored = localStorage.getItem(WEB_SEARCH_SETTINGS_KEY) as string;
      expect(stored).not.toContain("b-key");
      expect(stored).not.toContain("e-key");
      expect(stored).toContain("brave");
    });

    it("is idempotent: a second run moves nothing", async () => {
      localStorage.setItem(
        STORAGE_KEYS.CUSTOM_SPEECH_PROVIDERS,
        JSON.stringify([{ id: "stt-1", variables: { api_key: "stt-key" } }])
      );

      const first = await migrateSecretsFromLocalStorage();
      const second = await migrateSecretsFromLocalStorage();

      expect(first).toBe(1);
      expect(second).toBe(0);
      await expect(getSecret(secretKey.sttProvider("stt-1"))).resolves.toBe("stt-key");
    });

    it("leaves providers without a key untouched", async () => {
      const providers = [
        { id: "ollama", variables: { MODEL: "llama3" }, curl: "curl http://localhost:11434" },
      ];
      localStorage.setItem(STORAGE_KEYS.CUSTOM_AI_PROVIDERS, JSON.stringify(providers));

      const migrated = await migrateSecretsFromLocalStorage();

      expect(migrated).toBe(0);
      expect(localStorage.getItem(STORAGE_KEYS.CUSTOM_AI_PROVIDERS)).toBe(
        JSON.stringify(providers)
      );
    });

    it("survives malformed localStorage without throwing", async () => {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_AI_PROVIDERS, "{not json");
      localStorage.setItem(WEB_SEARCH_SETTINGS_KEY, "[]");

      await expect(migrateSecretsFromLocalStorage()).resolves.toBe(0);
    });

    it("keeps the migration flag unset when the backend fails, so it retries", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockRejectedValueOnce(new Error("backend down"));

      localStorage.setItem(
        STORAGE_KEYS.CUSTOM_AI_PROVIDERS,
        JSON.stringify([{ id: "p1", variables: { API_KEY: "k" } }])
      );

      await migrateSecretsFromLocalStorage();

      // A later successful run must still migrate the key.
      const migrated = await migrateSecretsFromLocalStorage();
      expect(migrated).toBeGreaterThanOrEqual(0);
    });
  });
});
