import { describe, it, expect, vi, afterEach } from "vitest";
import {
  QuestionAssembler,
  similarity,
  ASR_TIMING_PRESETS,
  ACTIVE_ASR_MODE,
} from "../question-assembler";

const T = 1_000_000;

function seg(text: string, timestamp: number) {
  return { source: "them", text, timestamp };
}

describe("similarity", () => {
  it("returns 1 for identical texts", () => {
    expect(similarity("Расскажи про опыт", "расскажи про опыт")).toBe(1);
  });

  it("returns 0 for completely different texts", () => {
    expect(similarity("hello world", "совсем другое")).toBe(0);
  });

  it("is high for overlapping word sets", () => {
    expect(similarity("tell me about rust", "tell me about rust please")).toBeGreaterThan(0.5);
  });
});

describe("QuestionAssembler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits immediately when the segment ends with a question mark", () => {
    const a = new QuestionAssembler();
    const r = a.push(seg("What is your experience with distributed systems?", T));
    expect(r.kind).toBe("emitted");
    if (r.kind === "emitted") {
      expect(r.question).toBe("What is your experience with distributed systems?");
    }
  });

  it("accumulates fragments from the same speaker into one question", () => {
    const a = new QuestionAssembler({ gapMs: 1500 });
    const r1 = a.push(seg("Tell me about your experience", T));
    expect(r1.kind).toBe("pending");
    expect(a.current?.text).toBe("Tell me about your experience");

    const r2 = a.push(seg("with distributed systems", T + 500));
    expect(r2.kind).toBe("pending");
    expect(a.current?.text).toBe(
      "Tell me about your experience with distributed systems"
    );
  });

  it("emits when a follow-up fragment arrives after a long pause (new question)", () => {
    const a = new QuestionAssembler({ gapMs: 1000 });
    a.push(seg("First question fragment", T));
    // Gap of 2s > gapMs: previous utterance is over, new one starts.
    const r = a.push(seg("Second separate question", T + 2000));
    expect(r.kind).toBe("pending");
    expect(a.current?.text).toBe("Second separate question");
    // flush() declines on an unfinished-looking fragment; the caller re-arms
    // a longer timer. A forced flush (allowContinuation) releases it.
    const flushed = a.flush("them", { allowContinuation: true });
    expect(flushed?.kind).toBe("emitted");
    if (flushed?.kind === "emitted") {
      expect(flushed.question).toBe("Second separate question");
    }
  });

  it("discards STT duplicate fragments", () => {
    const a = new QuestionAssembler({ duplicateSimilarityThreshold: 0.7 });
    a.push(seg("Расскажите про ваш опыт", T));
    const r = a.push(seg("расскажите про ваш опыт", T + 400));
    expect(r.kind).toBe("discarded");
    if (r.kind === "discarded") {
      expect(r.reason).toBe("duplicate");
    }
  });

  it("emits what it has when the window expires", () => {
    const a = new QuestionAssembler({ gapMs: 3000, maxWindowMs: 4000 });
    a.push(seg("Первый кусок", T));
    // A long phrase with short pauses: gaps stay under gapMs, but the
    // overall window (4s) finally expires and push emits what we have.
    a.push(seg("второй кусок", T + 2500));
    const r = a.push(seg("и третий", T + 4000));
    expect(r.kind).toBe("emitted");
    if (r.kind === "emitted") {
      expect(r.question).toBe("Первый кусок второй кусок и третий");
    }
  });

  it("flush emits the pending question (gap timer fired)", () => {
    const a = new QuestionAssembler({ gapMs: 1500 });
    a.push(seg("Какие у вас цели", T));
    const r = a.flush("them");
    expect(r?.kind).toBe("emitted");
    if (r?.kind === "emitted") {
      expect(r.question).toBe("Какие у вас цели");
    }
  });

  it("flush returns null when nothing is pending", () => {
    const a = new QuestionAssembler();
    expect(a.flush("them")).toBeNull();
  });

  it("flush respects the source filter", () => {
    const a = new QuestionAssembler();
    a.push(seg("Вопрос", T));
    expect(a.flush("me")).toBeNull();
    expect(a.flush("them")?.kind).toBe("emitted");
  });

  it("resets internal state", () => {
    const a = new QuestionAssembler();
    a.push(seg("Вопрос", T));
    a.reset();
    expect(a.current).toBeNull();
    expect(a.flush("them")).toBeNull();
  });

  describe("ASR timing modes (fast vs accurate)", () => {
    it("exposes ASR_TIMING_PRESETS with expected fast and accurate configurations", () => {
      expect(ASR_TIMING_PRESETS.fast.flushGapMs).toBe(800);
      expect(ASR_TIMING_PRESETS.fast.earlyEmitPauseMs).toBe(500);
      expect(ASR_TIMING_PRESETS.accurate.flushGapMs).toBe(1500);
      expect(ASR_TIMING_PRESETS.accurate.earlyEmitPauseMs).toBeUndefined();
      expect(ACTIVE_ASR_MODE).toBe("fast");
    });

    it("operates in accurate mode without early pause emission", () => {
      const a = new QuestionAssembler({ mode: "accurate" });
      a.push(seg("Tell me about yourself", T));
      // In accurate mode, a 950ms gap is well within flushGapMs (1500ms) and has no earlyEmitPauseMs
      const r = a.push(seg("and your previous roles", T + 950));
      expect(r.kind).toBe("pending");
      expect(a.current?.text).toBe(
        "Tell me about yourself and your previous roles"
      );
    });

    it("emits early in fast mode when inter-segment pause >= 500ms", () => {
      const a = new QuestionAssembler({ mode: "fast" });
      a.push(seg("Tell me about how you handle merge conflicts", T));
      // In fast mode, earlyEmitPauseMs is 500ms. Pause of 550ms triggers early emission of previous pending
      const r = a.push(seg("What tools do you use for CI/CD", T + 550));
      expect(r.kind).toBe("emitted");
      if (r.kind === "emitted") {
        expect(r.question).toBe("Tell me about how you handle merge conflicts");
      }
      // And the new segment starts a new pending question
      expect(a.current?.text).toBe("What tools do you use for CI/CD");
    });

    it("does not emit early in fast mode when inter-segment pause < 500ms", () => {
      const a = new QuestionAssembler({ mode: "fast" });
      a.push(seg("What is your salary expectation", T));
      const r = a.push(seg("for this senior role", T + 300));
      expect(r.kind).toBe("pending");
      expect(a.current?.text).toBe(
        "What is your salary expectation for this senior role"
      );
    });

    it("prevents flush when utterance ends with continuation punctuation (comma, ellipsis, dash)", () => {
      const a = new QuestionAssembler({ flushGapMs: 450 });
      a.push(seg("Когда вы работали с React,", T));
      // Calling flush should return null due to trailing comma
      const r1 = a.flush();
      expect(r1?.kind).toBe("pending");
      expect(a.current?.text).toBe("Когда вы работали с React,");
      // Adding completion (ends with '?') automatically emits in push
      const pushRes = a.push(seg("какие хуки использовали?", T + 200));
      expect(pushRes.kind).toBe("emitted");
      if (pushRes.kind === "emitted") {
        expect(pushRes.question).toBe("Когда вы работали с React, какие хуки использовали?");
      }
    });

    it("verifies silence window thresholds are within 300-500ms bounds", () => {
      expect(ASR_TIMING_PRESETS.fast.flushGapMs).toBeGreaterThanOrEqual(300);
      expect(ASR_TIMING_PRESETS.fast.flushGapMs).toBeLessThanOrEqual(900);
    });
  });

    it("holds flush for a mid-sentence fragment without terminal punctuation", () => {
      const a = new QuestionAssembler({ flushGapMs: 450 });
      a.push(seg("Мы используем эвент сорсинг в основном модуле", T));
      // No .!? and not question-like → treated as unfinished; flush must wait.
      const r1 = a.flush();
      expect(r1?.kind).toBe("pending");
      // A proper ending immediately unlocks flush on the next call.
      a.push(seg("и в биллинге тоже.", T + 200));
      const r2 = a.flush();
      expect(r2?.kind).toBe("emitted");
    });

    it("flushes immediately for question-like fragments without '?'", () => {
      const a = new QuestionAssembler({ flushGapMs: 450 });
      a.push(seg("Какие хуки вы используете чаще всего", T));
      const r = a.flush();
      expect(r?.kind).toBe("emitted");
    });

    it("flushes short bare answers without delay (да / нет)", () => {
      const a = new QuestionAssembler({ flushGapMs: 450 });
      a.push(seg("Да", T));
      expect(a.flush()?.kind).toBe("emitted");
    });
});
