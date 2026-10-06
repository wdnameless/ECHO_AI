import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AUTO_ASK_STORAGE_KEYS,
  clampSilenceDuration,
  getAutoAskConfig,
  saveAutoAskConfig,
  shouldAutoAsk,
  AutoAskManager,
  resolveAutoAskTarget,
} from "../auto-ask";
import { setAnswerMode } from "../answer-mode";
import { safeLocalStorage } from "../storage/helper";

describe("auto-ask", () => {
  beforeEach(() => {
    safeLocalStorage.removeItem(AUTO_ASK_STORAGE_KEYS.ENABLED);
    safeLocalStorage.removeItem(AUTO_ASK_STORAGE_KEYS.SILENCE_DURATION);
    safeLocalStorage.removeItem(AUTO_ASK_STORAGE_KEYS.MODE);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("config and storage", () => {
    it("answers on its own by default, with the mode switch as the opt-out", () => {
      // The panel's Авто/Вручную control is what turns automatic answering off;
      // `enabled` only survives for configs written by older builds.
      const config = getAutoAskConfig();
      expect(config.enabled).toBe(true);
      expect(config.mode).toBe("auto");
      expect(config.silenceDurationMs).toBe(1000);
    });

    it("clamps silence duration to 500-5000 range", () => {
      expect(clampSilenceDuration(200)).toBe(500);
      expect(clampSilenceDuration(6000)).toBe(5000);
      expect(clampSilenceDuration(2500)).toBe(2500);
      expect(clampSilenceDuration(NaN)).toBe(1000);
    });

    it("saves and retrieves config correctly", () => {
      const saved = saveAutoAskConfig({ enabled: true, silenceDurationMs: 2000, mode: "manual" });
      expect(saved.enabled).toBe(true);
      expect(saved.silenceDurationMs).toBe(2000);
      expect(saved.mode).toBe("manual");

      const loaded = getAutoAskConfig();
      expect(loaded.enabled).toBe(true);
      expect(loaded.silenceDurationMs).toBe(2000);
      expect(loaded.mode).toBe("manual");
    });
  });

  describe("shouldAutoAsk guards", () => {
    it("blocks dispatch when auto-ask is disabled or mode is manual", () => {
      const allowedDisabled = shouldAutoAsk({
        enabled: false,
        text: "Как работает сборщик мусора в Go?",
        isAIProcessing: false,
      });
      expect(allowedDisabled).toBe(false);

      const allowedManual = shouldAutoAsk({
        enabled: true,
        mode: "manual",
        text: "Как работает сборщик мусора в Go?",
        isAIProcessing: false,
      });
      expect(allowedManual).toBe(false);
    });

    it("blocks dispatch when AI is currently busy processing", () => {
      const allowed = shouldAutoAsk({
        enabled: true,
        text: "Расскажи про микросервисную архитектуру",
        isAIProcessing: true,
      });
      expect(allowed).toBe(false);
    });

    it("blocks dispatch for empty or whitespace text", () => {
      expect(
        shouldAutoAsk({
          enabled: true,
          text: "   ",
          isAIProcessing: false,
        })
      ).toBe(false);
      expect(
        shouldAutoAsk({
          enabled: true,
          text: "",
          isAIProcessing: false,
        })
      ).toBe(false);
    });

    it("blocks dispatch for filler or backchannel words", () => {
      expect(
        shouldAutoAsk({
          enabled: true,
          text: "угу",
          isAIProcessing: false,
        })
      ).toBe(false);
      expect(
        shouldAutoAsk({
          enabled: true,
          text: "мгм",
          isAIProcessing: false,
        })
      ).toBe(false);
      expect(
        shouldAutoAsk({
          enabled: true,
          text: "ага",
          isAIProcessing: false,
        })
      ).toBe(false);
      expect(
        shouldAutoAsk({
          enabled: true,
          text: "yeah",
          isAIProcessing: false,
        })
      ).toBe(false);
    });

    it("allows dispatch for genuine questions or meaningful statements", () => {
      expect(
        shouldAutoAsk({
          enabled: true,
          text: "Что такое CAP теорема?",
          isAIProcessing: false,
        })
      ).toBe(true);
      expect(
        shouldAutoAsk({
          enabled: true,
          text: "Объясни разницу между процессами и потоками",
          isAIProcessing: false,
        })
      ).toBe(true);
    });
  });

  describe("AutoAskManager lifecycle", () => {
    it("debounces dispatch according to configured silence duration", () => {
      const onDispatch = vi.fn();
      let busy = false;

      const manager = new AutoAskManager({
        getConfig: () => ({ enabled: true, silenceDurationMs: 1500, mode: "auto" }),
        onDispatch,
        isAIProcessing: () => busy,
      });

      manager.onFinalizedTranscript("Расскажи про индексы в Postgres");

      expect(onDispatch).not.toHaveBeenCalled();

      // Advance by 1000ms (silence not reached)
      vi.advanceTimersByTime(1000);
      expect(onDispatch).not.toHaveBeenCalled();

      // Another word comes in before silence expires, resets debounce
      manager.onFinalizedTranscript("Расскажи про индексы в Postgres и B-Tree");
      vi.advanceTimersByTime(1000);
      expect(onDispatch).not.toHaveBeenCalled();

      // Advance past silence duration
      vi.advanceTimersByTime(600);
      expect(onDispatch).toHaveBeenCalledTimes(1);
      expect(onDispatch).toHaveBeenCalledWith("Расскажи про индексы в Postgres и B-Tree");
    });

    it("does not dispatch if AI became busy during silence wait", () => {
      const onDispatch = vi.fn();
      let busy = false;

      const manager = new AutoAskManager({
        getConfig: () => ({ enabled: true, silenceDurationMs: 1000, mode: "auto" }),
        onDispatch,
        isAIProcessing: () => busy,
      });

      manager.onFinalizedTranscript("В чем отличие TCP от UDP?");
      // AI started processing something else
      busy = true;

      vi.advanceTimersByTime(1100);
      expect(onDispatch).not.toHaveBeenCalled();
    });

    it("cancels timer and does not dispatch when cancel is called", () => {
      const onDispatch = vi.fn();

      const manager = new AutoAskManager({
        getConfig: () => ({ enabled: true, silenceDurationMs: 1000, mode: "auto" }),
        onDispatch,
        isAIProcessing: () => false,
      });
      manager.onFinalizedTranscript("Как оптимизировать SQL запрос?");
      manager.cancel();

      vi.advanceTimersByTime(1500);
      expect(onDispatch).not.toHaveBeenCalled();
    });
  });

  /**
   * The stored conversation showed one thought answered three times as it grew:
   *
   *   "Ты не виноват."                                             -> answer 1
   *   "Ты не виноват. Просто не повезло. ..."                      -> answer 2
   *   "Ты не виноват. Просто не повезло. ... вс<unk>."             -> answer 3
   *
   * The assembler flushes on a pause, the interviewer keeps talking, and the
   * next flush carries the earlier text plus the new tail. The manual
   * "Ответить" path refuses a repeat by utterance id; the automatic path had
   * no such check, and every emission was dispatched.
   */
  describe("a question heard again as it grows is asked once", () => {
    const manager = (onDispatch: (t: string) => void) =>
      new AutoAskManager({
        getConfig: () => ({ enabled: true, silenceDurationMs: 1000, mode: "auto" }),
        onDispatch,
        isAIProcessing: () => false,
      });

    it("drops the repeats and keeps the first dispatch", () => {
      const asked: string[] = [];
      const m = manager((t) => asked.push(t));

      m.dispatchNow("Ты не виноват.");
      m.dispatchNow(
        "Ты не виноват. Просто не повезло. Пусть не сейчас, но будет еще экзамен. У тебя все шансы попасть в мед."
      );
      m.dispatchNow(
        "Ты не виноват. Просто не повезло. Пусть не сейчас, но будет еще экзамен. У тебя все шансы попасть в мед. Нужно просто взять себя в руки и вс<unk>."
      );

      expect(asked).toEqual(["Ты не виноват."]);
    });

    it("still asks a question that shares no words with the previous one", () => {
      const asked: string[] = [];
      const m = manager((t) => asked.push(t));

      m.dispatchNow("Ты не виноват. Просто не повезло.");
      m.dispatchNow("В школу ходить не будешь. Я им скажу, что ты на практике. Ясно?");

      expect(asked).toHaveLength(2);
    });

    it("guards the silence-timer path as well as dispatchNow", () => {
      const asked: string[] = [];
      const m = manager((t) => asked.push(t));

      m.dispatchNow("Ты не виноват. Просто не повезло.");
      // The timer path calls onDispatch directly, bypassing dispatchNow.
      vi.advanceTimersByTime(1000);
      m.onFinalizedTranscript(
        "Ты не виноват. Просто не повезло. Пусть не сейчас, но будет еще экзамен."
      );
      vi.advanceTimersByTime(1000);

      expect(asked).toHaveLength(1);
    });

    it("does not let a short interjection block the next question", () => {
      const asked: string[] = [];
      const m = manager((t) => asked.push(t));

      // "Да." is a filler and is filtered; the point is that a genuinely new
      // question after a short line still goes out.
      m.dispatchNow("Расскажи про индексы в Postgres и B-Tree пожалуйста");
      m.dispatchNow("А как работает репликация в Postgres при отказе мастера?");

      expect(asked).toHaveLength(2);
    });

    it("lets the same words be a new question once the window has passed", () => {
      const asked: string[] = [];
      const m = manager((t) => asked.push(t));

      const q = "Что такое репликация в Postgres и как она работает?";
      m.dispatchNow(q);
      // Seconds later it is the same utterance heard twice — suppression.
      vi.advanceTimersByTime(5_000);
      m.dispatchNow(q);
      expect(asked).toHaveLength(1);

      // A minute later the interviewer has genuinely repeated themselves.
      vi.advanceTimersByTime(60_000);
      m.dispatchNow(q);
      expect(asked).toHaveLength(2);
      expect(asked).toHaveLength(2);
    });
  });

  describe("AutoAsk routing (R02 livecode)", () => {
    it("resolves route target based on answer mode", () => {
      expect(resolveAutoAskTarget("livecode")).toBe("code");
      expect(resolveAutoAskTarget("interview")).toBe("interview");
      expect(resolveAutoAskTarget("thought")).toBe("interview");
    });

    it("routes auto-ask dispatch to onDispatchCode when livecode active", () => {
      const onDispatch = vi.fn();
      const onDispatchCode = vi.fn();
      const manager = new AutoAskManager({
        getConfig: () => ({ enabled: true, silenceDurationMs: 1000, mode: "auto" }),
        getAnswerMode: () => "livecode",
        onDispatch,
        onDispatchCode,
        isAIProcessing: () => false,
      });

      manager.dispatchNow("Напиши функцию троттлинга");
      expect(onDispatchCode).toHaveBeenCalledWith("Напиши функцию троттлинга");
      expect(onDispatch).not.toHaveBeenCalled();
    });

    it("routes auto-ask to standard onDispatch with target when in interview mode", () => {
      const onDispatch = vi.fn();
      const onDispatchCode = vi.fn();
      const manager = new AutoAskManager({
        getConfig: () => ({ enabled: true, silenceDurationMs: 1000, mode: "auto" }),
        getAnswerMode: () => "interview",
        onDispatch,
        onDispatchCode,
        isAIProcessing: () => false,
      });

      manager.dispatchNow("Расскажи про события в браузере");
      expect(onDispatch).toHaveBeenCalledWith("Расскажи про события в браузере");
      expect(onDispatchCode).not.toHaveBeenCalled();
    });
  });
});
