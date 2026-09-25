import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  WEB_SEARCH_SETTINGS_KEY,
  getWebSearchSettings,
  saveWebSearchSettings,
  getWebSearchKey,
  setWebSearchKey,
  stripLegacyWebSearchKeys,
} from "../web-search";

/**
 * Фейковый бэкенд защищённого хранилища: держит секреты в памяти и повторяет
 * контракт Rust-команд, чтобы тесты не зависели от Tauri.
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

describe("web-search secret handling", () => {
  beforeEach(() => {
    store.clear();
    localStorage.clear();
  });

  it("writes a search key to the secure store, not to localStorage", async () => {
    await setWebSearchKey("brave", "bsa-secret");

    await expect(getWebSearchKey("brave")).resolves.toBe("bsa-secret");

    const raw = localStorage.getItem(WEB_SEARCH_SETTINGS_KEY) ?? "";
    expect(raw).not.toContain("bsa-secret");
  });

  it("drops a key from the secure store when it is cleared", async () => {
    await setWebSearchKey("exa", "exa-secret");
    await setWebSearchKey("exa", "");

    await expect(getWebSearchKey("exa")).resolves.toBeNull();
  });

  it("never persists secret fields handed to saveWebSearchSettings", () => {
    saveWebSearchSettings({
      enabled: true,
      provider: "brave",
      maxResults: 5,
      // Ключ пришёл от вызывающей стороны — настройки обязаны его отбросить.
      braveApiKey: "must-not-persist",
    } as never);

    const raw = localStorage.getItem(WEB_SEARCH_SETTINGS_KEY) ?? "";
    expect(raw).not.toContain("must-not-persist");
    expect(getWebSearchSettings()).toMatchObject({
      enabled: true,
      provider: "brave",
      maxResults: 5,
    });
  });

  it("migrates a legacy key out of localStorage on first read", async () => {
    localStorage.setItem(
      WEB_SEARCH_SETTINGS_KEY,
      JSON.stringify({ provider: "tavily", tavilyApiKey: "tvly-legacy" })
    );

    await expect(getWebSearchKey("tavily")).resolves.toBe("tvly-legacy");

    // Ключ доступен из хранилища и стёрт из открытого localStorage.
    await expect(getWebSearchKey("tavily")).resolves.toBe("tvly-legacy");
    expect(localStorage.getItem(WEB_SEARCH_SETTINGS_KEY)).not.toContain(
      "tvly-legacy"
    );
  });

  it("leaves the public settings untouched when stripping legacy keys", () => {
    localStorage.setItem(
      WEB_SEARCH_SETTINGS_KEY,
      JSON.stringify({
        enabled: true,
        provider: "brave",
        maxResults: 7,
        braveApiKey: "legacy",
      })
    );

    stripLegacyWebSearchKeys();

    const stored = localStorage.getItem(WEB_SEARCH_SETTINGS_KEY) ?? "";
    expect(stored).not.toContain("legacy");
    expect(getWebSearchSettings()).toMatchObject({
      enabled: true,
      provider: "brave",
      maxResults: 7,
    });
  });
});

/**
 * The dispatch path used to clear the legacy field before anything read it.
 *
 * `getWebSearchKey` is the only code that migrates the key out of localStorage,
 * and the path that used to call it early (`migrateSecretsFromLocalStorage`)
 * returns immediately once `secrets_migrated_v1` is set — the normal state of an
 * existing install. Measured on a live profile: that flag was `true` while
 * `web_search_keys_migrated` was unset, so the migration never ran and the first
 * keyed search destroyed a paid API key instead of moving it.
 *
 * This drives the REAL `performWebSearch` and asserts on the credential it sends,
 * so it fails if the order is ever inverted again.
 */
describe("first keyed search must not destroy the key", () => {
  it("sends the migrated key instead of falling back to keyless search", async () => {
    localStorage.setItem(
      WEB_SEARCH_SETTINGS_KEY,
      JSON.stringify({
        enabled: true,
        provider: "brave",
        maxResults: 3,
        braveApiKey: "bsa-paid-key",
      })
    );
    // A real install has the general migration already done.
    localStorage.setItem("secrets_migrated_v1", "true");

    const { performWebSearch } = await import("../web-search");
    const sent: Array<Record<string, string>> = [];
    vi.stubGlobal("fetch", async (_url: string, init?: { headers?: Record<string, string> }) => {
      sent.push(init?.headers ?? {});
      return {
        json: async () => ({ web: { results: [] } }),
      };
    });

    await performWebSearch("kafka");

    // The provider call must carry the key — not a keyless DuckDuckGo fallback,
    // and above all not nothing at all (the key would be gone for good).
    const token = sent.map((h) => h["X-Subscription-Token"]).find(Boolean);
    expect(token).toBe("bsa-paid-key");
    expect(localStorage.getItem(WEB_SEARCH_SETTINGS_KEY) ?? "").not.toContain(
      "bsa-paid-key"
    );
    vi.unstubAllGlobals();
  });
});
