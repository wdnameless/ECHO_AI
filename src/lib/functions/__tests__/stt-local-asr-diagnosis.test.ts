import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TYPE_PROVIDER } from "@/types";

/**
 * Отказ локального движка распознавания выглядел как сетевая ошибка на loopback
 * — по ней нельзя было понять, не выбран речевой движок или он не поднялся.
 * Бэкенд уже умеет отвечать на этот вопрос (`stt_readiness`), поэтому путь
 * ошибки обязан спросить его. Тест фиксирует, что спрошено именно он, и что
 * ответ HTTP (движок жив) диагностикой не подменяется.
 */

const invokeMock = vi.fn();
const pluginFetchMock = vi.fn();
const windowFetchMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => pluginFetchMock(...args),
}));

// `@/lib` re-exports the STT pipeline itself: importing the real barrel here
// would be a cycle, so only the settings reader is stubbed.
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

const transcribe = () =>
  fetchSTT({
    provider: LOCAL_PROVIDER,
    selectedProvider: { provider: "handy-local-whisper", variables: {} },
    audio: audio(),
  });

beforeEach(() => {
  invokeMock.mockReset();
  pluginFetchMock.mockReset();
  windowFetchMock.mockReset();
  window.fetch = windowFetchMock as unknown as typeof window.fetch;
});

describe("local ASR failure diagnosis", () => {
  it("reports what the backend says is missing instead of a network error", async () => {
    const reason =
      "Модель распознавания не найдена. Откройте «Настройки → Хранилище и модели» и скачайте подходящую.";
    windowFetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    pluginFetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "stt_readiness"
        ? Promise.resolve({
            engine_running: false,
            model_found: false,
            model_path: null,
            models_dir: "D:/models",
            reason,
          })
        : Promise.resolve(undefined)
    );

    await expect(transcribe()).rejects.toThrow(reason);
    expect(invokeMock).toHaveBeenCalledWith("stt_readiness");
  });

  it("keeps the server's own error when the engine answered", async () => {
    // Readiness would happily explain this away as "the engine is down" — it is
    // the tempting answer here, and the one that must not win.
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "stt_readiness"
        ? Promise.resolve({
            engine_running: false,
            model_found: false,
            model_path: null,
            models_dir: "D:/models",
            reason: "Движок распознавания не запущен.",
          })
        : Promise.resolve(undefined)
    );
    windowFetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "boom",
    });

    await expect(transcribe()).rejects.toThrow("HTTP 500: boom");
    expect(invokeMock).not.toHaveBeenCalledWith("stt_readiness");
  });

  /**
   * A request URL that lost its origin resolves against the WebView's own
   * origin, and the SPA answers it with `HTTP 200 text/html`. That page used to
   * be returned as the transcription: the feed showed
   * `<!DOCTYPE html>…<title>Tauri + React</title>` as the interviewer's speech
   * and the AI answered the markup. Verified live: the relative URL really does
   * return the app's page with status 200.
   */
  it("refuses the app's own page instead of returning it as speech", async () => {
    windowFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      // The first bytes of the real page, as served for `null/v1/asr/transcribe`.
      text: async () =>
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Tauri + React + Typescript</title>',
    });

    const result = await transcribe();
    expect(result).toContain("STT Error");
    expect(result).not.toContain("<!DOCTYPE");
    expect(result).toContain("web page");
  });

  it("still returns a real transcription", async () => {
    windowFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ text: "Пошли, бля!" }),
    });

    expect(await transcribe()).toBe("Пошли, бля!");
  });
});
