import { describe, it, expect, vi, afterEach } from "vitest";
import { QuestionAssembler, similarity } from "../question-assembler";

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
    // flush releases the newest accumulated question
    const flushed = a.flush("them");
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
});
