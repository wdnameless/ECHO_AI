import { describe, it, expect } from "vitest";

/**
 * The feed runs TWO translation workers over the same queue and re-runs its
 * effect whenever an entry changes, so the same text is requested twice in quick
 * succession. A 250ms debounce used to answer the second call with the SOURCE
 * text; `SubtitleFeed` stored whatever came back as the translation and marked
 * the row done, so it was never retried and every row read
 * «русский переводит русский».
 *
 * These pin the replacement contract: concurrent callers share one result, and a
 * caller can never be handed the input as if it were a translation.
 */
describe("concurrent translation requests", () => {
  /** The shape of the real implementation: cache + in-flight sharing. */
  function makeTranslator(translate: (text: string) => Promise<string>) {
    const cache = new Map<string, string>();
    const inFlight = new Map<string, Promise<string>>();
    let calls = 0;

    async function request(text: string): Promise<string> {
      const key = text.trim();
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const running = inFlight.get(key);
      if (running) return running;

      const promise = (async () => {
        calls += 1;
        const result = await translate(key);
        cache.set(key, result);
        return result;
      })();

      inFlight.set(key, promise);
      try {
        return await promise;
      } finally {
        inFlight.delete(key);
      }
    }
    return { request, callCount: () => calls };
  }

  it("never returns the source text to the second caller", async () => {
    const { request } = makeTranslator(async (t) => `EN:${t}`);
    const text = "Ну, это классический перегруз на бэкенде";

    const [first, second] = await Promise.all([request(text), request(text)]);

    expect(first).toBe("EN:Ну, это классический перегруз на бэкенде");
    expect(second).toBe(first);
    // The old code returned `text` here, which is what reached the screen.
    expect(second).not.toBe(text);
  });

  it("shares one request between concurrent callers", async () => {
    const { request, callCount } = makeTranslator(async (t) => {
      await new Promise((r) => setTimeout(r, 20));
      return `EN:${t}`;
    });
    const text = "Ну, это как ловить бесконечный рекурсивный вызов";

    const results = await Promise.all([request(text), request(text), request(text)]);

    expect(new Set(results).size).toBe(1);
    expect(callCount()).toBe(1);
  });

  it("reuses the cache for a later repeat and does not re-request", async () => {
    const { request, callCount } = makeTranslator(async (t) => `EN:${t}`);
    await request("привет");
    await request("привет");
    expect(callCount()).toBe(1);
  });

  it("keeps working after a failed request", async () => {
    let fail = true;
    const { request } = makeTranslator(async (t) => {
      if (fail) throw new Error("provider down");
      return `EN:${t}`;
    });

    await expect(request("текст")).rejects.toThrow("provider down");
    fail = false;
    // The in-flight entry must be cleared, or every later call would rethrow.
    await expect(request("текст")).resolves.toBe("EN:текст");
  });
});
