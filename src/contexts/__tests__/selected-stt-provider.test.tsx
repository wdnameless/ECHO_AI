import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { AppProvider, useApp } from "../app.context";
import { STORAGE_KEYS } from "@/config/constants";

/**
 * The stored STT provider must survive a launch.
 *
 * `loadData()` read the saved provider and then wrote the built-in local engine
 * over it (state AND localStorage) because the fallback sat in the same block
 * without an `else` — so a user who picked Groq or OpenAI STT lost the choice on
 * every start, and the `if` branch could never take effect at all.
 *
 * These tests drive the real provider with the real localStorage, which is what
 * makes them able to fail: a unit test of a copied-out snippet would pass
 * against the bug.
 */

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: vi.fn().mockResolvedValue(() => {}),
    label: "main",
  }),
}));

/** Reads the provider value out of the context (it re-exports 42 fields). */
let seen: { selectedSttProvider?: { provider?: string } } = {};
const Probe = () => {
  const app = useApp();
  seen = app as typeof seen;
  return null;
};

const CHOSEN = { provider: "groq", variables: { API_KEY: "k" } };

beforeEach(() => {
  seen = {};
  localStorage.clear();
});

describe("selected STT provider survives a launch", () => {
  it("keeps a stored non-default provider instead of resetting it", async () => {
    localStorage.setItem(
      STORAGE_KEYS.SELECTED_STT_PROVIDER,
      JSON.stringify(CHOSEN)
    );

    render(
      <AppProvider>
        <Probe />
      </AppProvider>
    );

    await waitFor(() =>
      expect(seen.selectedSttProvider?.provider).toBe("groq")
    );
    // And it must still be stored, not overwritten with the local engine.
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEYS.SELECTED_STT_PROVIDER) || "{}")
        .provider
    ).toBe("groq");
  });

  it("falls back to the local engine when nothing is stored", async () => {
    render(
      <AppProvider>
        <Probe />
      </AppProvider>
    );

    await waitFor(() =>
      expect(seen.selectedSttProvider?.provider).toBe("handy-local-whisper")
    );
  });

  it("falls back to the local engine when the stored value is corrupt", async () => {
    localStorage.setItem(STORAGE_KEYS.SELECTED_STT_PROVIDER, "{not json");

    render(
      <AppProvider>
        <Probe />
      </AppProvider>
    );

    await waitFor(() =>
      expect(seen.selectedSttProvider?.provider).toBe("handy-local-whisper")
    );
  });
});
