import { describe, it, expect, vi } from "vitest";
import {
  MonologueBuffer,
  dispatchMonologueConfirm,
  dispatchMonologueFlush,
  dispatchMonologueCancel,
  MONOLOGUE_EVENTS,
} from "../monologue-buffer";

describe("MonologueBuffer (R02: Monologue mode & continuous speech)", () => {
  it("initializes with default options", () => {
    const buffer = new MonologueBuffer();
    expect(buffer.getMode()).toBe("auto");
    expect(buffer.getStatus()).toBe("idle");
    expect(buffer.isEmpty()).toBe(true);
    expect(buffer.getText()).toBe("");
    expect(buffer.getSegments()).toEqual([]);
  });

  it("accumulates multiple non-stop speech segments into one coherent text", () => {
    const buffer = new MonologueBuffer({ mode: "auto", maxWindowMs: 15000 });
    const now = 1000;

    const push1 = buffer.push("Здравствуйте,", now);
    expect(push1.text).toBe("Здравствуйте,");
    expect(push1.shouldEmit).toBe(false);
    expect(buffer.getStatus()).toBe("accumulating");

    const push2 = buffer.push("сегодня мы обсудим архитектуру проекта,", now + 2000);
    expect(push2.text).toBe("Здравствуйте, сегодня мы обсудим архитектуру проекта,");
    expect(push2.shouldEmit).toBe(false);

    const push3 = buffer.push("а также план миграции базы данных.", now + 5000);
    expect(push3.text).toBe(
      "Здравствуйте, сегодня мы обсудим архитектуру проекта, а также план миграции базы данных."
    );
    expect(push3.shouldEmit).toBe(false);
    expect(buffer.getSegments()).toHaveLength(3);
  });

  it("deduplicates identical successive segments from STT echoes", () => {
    const buffer = new MonologueBuffer();

    buffer.push("Мы используем PostgreSQL");
    buffer.push("Мы используем PostgreSQL"); // duplicate
    expect(buffer.getSegments()).toHaveLength(1);

    buffer.push("для хранения транзакций");
    expect(buffer.getSegments()).toHaveLength(2);
    expect(buffer.getText()).toBe("Мы используем PostgreSQL для хранения транзакций");
  });

  it("mode 'auto': flushes and emits the whole chunk when silence gap occurs", () => {
    const onEmit = vi.fn();
    const buffer = new MonologueBuffer({ mode: "auto", onEmit });

    buffer.push("Первая часть речи.");
    buffer.push("Вторая часть речи.");

    const result = buffer.onSilenceGap();
    expect(result).not.toBeNull();
    expect(result?.text).toBe("Первая часть речи. Вторая часть речи.");
    expect(result?.segments).toEqual(["Первая часть речи.", "Вторая часть речи."]);
    expect(onEmit).toHaveBeenCalledWith(result);
    expect(buffer.isEmpty()).toBe(true);
    expect(buffer.getStatus()).toBe("idle");
  });

  it("mode 'auto': forces emission when speech duration exceeds maxWindowMs", () => {
    const buffer = new MonologueBuffer({ mode: "auto", maxWindowMs: 6000 });
    const start = 10000;

    const r1 = buffer.push("Начало длинного монолога,", start);
    expect(r1.shouldEmit).toBe(false);

    const r2 = buffer.push("продолжение без пауз...", start + 3000);
    expect(r2.shouldEmit).toBe(false);

    // After 6000ms duration from start
    const r3 = buffer.push("и еще несколько предложений.", start + 6500);
    expect(r3.windowExceeded).toBe(true);
    expect(r3.shouldEmit).toBe(true);
  });

  it("mode 'semi': marks status as 'ready' on silence gap without auto-emitting, emits on confirm", () => {
    const onEmit = vi.fn();
    const buffer = new MonologueBuffer({ mode: "semi", onEmit });

    buffer.push("Пользователь закончил говорить в полуавтоматическом режиме.");
    const silenceResult = buffer.onSilenceGap();

    // Should NOT emit automatically
    expect(silenceResult).toBeNull();
    expect(onEmit).not.toHaveBeenCalled();
    expect(buffer.getStatus()).toBe("ready");
    expect(buffer.isEmpty()).toBe(false);

    // User confirms dispatch
    const confirmed = buffer.confirm();
    expect(confirmed?.text).toBe(
      "Пользователь закончил говорить в полуавтоматическом режиме."
    );
    expect(onEmit).toHaveBeenCalledWith(confirmed);
    expect(buffer.isEmpty()).toBe(true);
    expect(buffer.getStatus()).toBe("idle");
  });

  it("mode 'manual': does not emit on silence gap, only emits on explicit flush/confirm", () => {
    const onEmit = vi.fn();
    const buffer = new MonologueBuffer({ mode: "manual", onEmit });

    buffer.push("Фрагмент раз.");
    buffer.push("Фрагмент два.");

    const gapResult = buffer.onSilenceGap();
    expect(gapResult).toBeNull();
    expect(onEmit).not.toHaveBeenCalled();
    expect(buffer.getStatus()).toBe("accumulating");

    // Manual flush triggered by user button
    const flushed = buffer.flush();
    expect(flushed?.text).toBe("Фрагмент раз. Фрагмент два.");
    expect(onEmit).toHaveBeenCalledWith(flushed);
    expect(buffer.isEmpty()).toBe(true);
  });

  it("clear() discards accumulated segments without emitting", () => {
    const onEmit = vi.fn();
    const buffer = new MonologueBuffer({ onEmit });

    buffer.push("Текст, который нужно отменить");
    expect(buffer.isEmpty()).toBe(false);

    buffer.clear();
    expect(buffer.isEmpty()).toBe(true);
    expect(buffer.getText()).toBe("");
    expect(onEmit).not.toHaveBeenCalled();
    expect(buffer.getStatus()).toBe("idle");
  });

  it("reconfigures mode, flushGapMs, and maxWindowMs dynamically", () => {
    const buffer = new MonologueBuffer({ mode: "auto", maxWindowMs: 4000, flushGapMs: 450 });

    buffer.reconfigure({ mode: "semi", maxWindowMs: 15000, flushGapMs: 1500 });
    expect(buffer.getMode()).toBe("semi");
    expect(buffer.getMaxWindowMs()).toBe(15000);
    expect(buffer.getFlushGapMs()).toBe(1500);
  });

  it("dispatches custom window events for confirm, flush, and cancel", () => {
    const confirmSpy = vi.fn();
    const flushSpy = vi.fn();
    const cancelSpy = vi.fn();

    window.addEventListener(MONOLOGUE_EVENTS.CONFIRM, confirmSpy);
    window.addEventListener(MONOLOGUE_EVENTS.FLUSH, flushSpy);
    window.addEventListener(MONOLOGUE_EVENTS.CANCEL, cancelSpy);

    dispatchMonologueConfirm();
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    dispatchMonologueFlush();
    expect(flushSpy).toHaveBeenCalledTimes(1);

    dispatchMonologueCancel();
    expect(cancelSpy).toHaveBeenCalledTimes(1);

    window.removeEventListener(MONOLOGUE_EVENTS.CONFIRM, confirmSpy);
    window.removeEventListener(MONOLOGUE_EVENTS.FLUSH, flushSpy);
    window.removeEventListener(MONOLOGUE_EVENTS.CANCEL, cancelSpy);
  });
});
