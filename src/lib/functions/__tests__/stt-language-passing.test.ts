import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TYPE_PROVIDER } from "@/types";

/**
 * Настройка «Язык распознавания» не действовала на batch-пути.
 *
 * Язык уходил только в config-фрейм WebSocket, а модель, которая не умеет
 * стримить (Parakeet TDT), сокета не открывает вовсе — остаётся HTTP-путь,
 * где язык не передавался. Поэтому выбор «Русский» не влиял ни на что.
 *
 * Тест фиксирует, что язык доезжает до URL batch-запроса, и что `auto`
 * по-прежнему не отправляется: движок должен определять язык сам.
 */

const invokeMock = vi.fn();
const pluginFetchMock = vi.fn();
const windowFetchMock = vi.fn();
let storedLanguage = "ru";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => pluginFetchMock(...args),
}));

vi.mock("@/lib", () => ({
  getResponseSettings: () => ({ length: "short", language: "ru" }),
}));

vi.mock("@/lib/asr-discovery", () => ({
  getAsrBaseUrl: async () => "http://127.0.0.1:9877",
  resetAsrBaseUrlCache: () => {},
}));

vi.mock("@/lib/host-trust-gate", () => ({
  resolveOutboundHeaders: async (_url: string, headers: Record<string, string>) => ({
    allowed: true,
    headers,
  }),
}));

vi.mock("@/lib/asr-language", () => ({
  getAsrLanguage: () => storedLanguage,
  setAsrLanguage: () => {},
}));

vi.mock("../pluely.api", () => ({
  shouldUsePluelyAPI: async () => false,
}));

import { fetchSTT } from "../stt.function";

const LOCAL_PROVIDER: TYPE_PROVIDER = {
  id: "handy-local-whisper",
  curl: `curl -X POST "http://127.0.0.1:9877/v1/asr/transcribe" \\
      -H "Content-Type: audio/wav" \\
      --data-binary {{AUDIO}}`,
  responseContentPath: "text",
  streaming: false,
} as TYPE_PROVIDER;

const audio = () =>
  new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" });

/** URL the pipeline actually requested. */
async function requestedUrl(): Promise<string> {
  pluginFetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify({ text: "ok", language: null }),
  });
  windowFetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify({ text: "ok", language: null }),
  });
  await fetchSTT({
    provider: LOCAL_PROVIDER,
    selectedProvider: { provider: "handy-local-whisper", variables: {} },
    audio: audio(),
    priority: "high",
  });
  const called = [...pluginFetchMock.mock.calls, ...windowFetchMock.mock.calls];
  expect(called.length).toBeGreaterThan(0);
  const first = called[0][0];
  return typeof first === "string" ? first : String(first?.url ?? first);
}

describe("the recognition language reaches the batch endpoint", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    pluginFetchMock.mockReset();
    windowFetchMock.mockReset();
    window.fetch = windowFetchMock as unknown as typeof window.fetch;
    storedLanguage = "ru";
  });

  it("sends the chosen language as a query parameter", async () => {
    const url = await requestedUrl();
    expect(url).toContain("language=ru");
  });

  it("omits the parameter for auto so the engine keeps detecting", async () => {
    storedLanguage = "auto";
    const url = await requestedUrl();
    expect(url).not.toContain("language=");
  });

  it("sends English when that is what the user picked", async () => {
    storedLanguage = "en";
    const url = await requestedUrl();
    expect(url).toContain("language=en");
  });
});
