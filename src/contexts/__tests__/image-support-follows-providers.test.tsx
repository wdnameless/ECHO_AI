import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { AppProvider, useApp } from "@/contexts/app.context";

/**
 * `checkImageSupport` must re-run when the provider list changes.
 *
 * It decides whether the composer offers screenshots by looking for `{{IMAGE}}`
 * in the selected provider's curl template. Custom providers load
 * ASYNCHRONOUSLY, after the effect's first run — so if the effect does not depend
 * on the provider list, it keeps the verdict from its first run, when the list
 * was still empty, and the lookup misses. The observable result: a provider that
 * CAN take images reports that it cannot (or the reverse), and only a restart
 * fixes it.
 *
 * This was a real defect twice: first reading through a ref (a ref never
 * triggers an effect), then a moved effect whose dependency array was not
 * updated. The assertion is on the CONTEXT VALUE, so it fails in both cases.
 */
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ listen: vi.fn().mockResolvedValue(() => {}), label: "main" }),
}));

/**
 * A provider whose template does NOT support images.
 *
 * The direction matters for the test: while the list is empty the lookup misses
 * and the effect takes its `else` branch, which reports `true`. Once the provider
 * arrives the CORRECT verdict is `false`, so a test that asserts `true` would pass
 * either way — an earlier version of this file did exactly that and was vacuous.
 */
const TEXT_ONLY_PROVIDER = {
  id: "custom-text-only",
  name: "Custom",
  curl: `curl https://example.test/v1/chat/completions \\
    -d '{"messages":[{"role":"user","content":"{{TEXT}}"}]}'`,
  streaming: true,
};

let seen: { supportsImages?: boolean; loadData?: () => void } = {};
const Probe = () => {
  const app = useApp();
  seen = app as typeof seen;
  return null;
};

beforeEach(() => {
  seen = {};
  localStorage.clear();
  localStorage.setItem(
    "curl_selected_ai_provider",
    JSON.stringify({ provider: TEXT_ONLY_PROVIDER.id, variables: {} })
  );
});

describe("image support follows the provider list", () => {
  it("re-checks when a custom provider arrives after mount", async () => {
    render(
      <AppProvider>
        <Probe />
      </AppProvider>
    );

    // First run: the custom provider is not stored yet, so the lookup misses and
    // the effect guesses `true` in its `else` branch.
    await waitFor(() => expect(seen.supportsImages).toBe(true));

    // The provider is saved and `loadData` runs — the app's real path for this
    // (a storage event in another window, or a settings change).
    await act(async () => {
      localStorage.setItem(
        "curl_custom_ai_providers",
        JSON.stringify([TEXT_ONLY_PROVIDER])
      );
      seen.loadData?.();
      await Promise.resolve();
    });

    // The effect must re-run against the new list: this provider takes text only.
    await waitFor(() => expect(seen.supportsImages).toBe(false));
  });
});
