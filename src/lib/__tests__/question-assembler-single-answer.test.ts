import { describe, it, expect } from "vitest";
import { QuestionAssembler } from "../question-assembler";

const T = 1_700_000_000_000;

/**
 * The reported failure, in the timeline the batch path really produces.
 *
 * The recogniser returns text ~1.1s after the speech that produced it, so two
 * fragments of ONE interviewer question arrive 3-4s apart even though the
 * speaker only paused ~300ms mid-sentence. Measuring the pause from the arrival
 * interval (what `timestamp` alone provides) made the assembler treat the
 * second half as a fresh question and drop the first half. The capture layer
 * now passes the pause measured between the VAD's own events.
 */
describe("one interviewer utterance is answered once", () => {
  // Speech ends at T; its text arrives 1.1s later.
  const LAG = 1100;

  it("merges a tail fragment into the parent question instead of dropping text", () => {
    const a = new QuestionAssembler({ mode: "fast" });

    // The first half is emitted by the pipeline's own gap timer.
    a.push({
      source: "them",
      text: "Now tell me about your experience with distributed systems",
      timestamp: T + LAG,
      pauseBeforeMs: 300,
    });
    const emitted = a.flush("them", { allowContinuation: true });
    expect(emitted?.kind).toBe("emitted");

    // A long thinking pause, then a short non-question tail. It must be merged
    // back into the answered question, not answered as a standalone fragment.
    const tail = a.push({
      source: "them",
      text: "and how you handled reliability in production.",
      timestamp: T + 300 + 3000 + LAG,
      pauseBeforeMs: 900,
    });

    expect(tail.kind).toBe("pending");
    expect(a.current?.text).toBe(
      "Now tell me about your experience with distributed systems and how you handled reliability in production."
    );
  });

  it("keeps a monologue together across a mid-sentence pause", () => {
    const a = new QuestionAssembler({ mode: "fast" });

    // First fragment: 300ms of silence preceded it.
    const first = a.push({
      source: "them",
      text: "Thank you. You got to know, wait, wait, wait.",
      timestamp: T + LAG,
      pauseBeforeMs: 300,
    });
    expect(first.kind).toBe("pending");

    // Second fragment spoken 3s long, after only a 300ms pause. Arrival gap is
    // 3.3s, but the AUDIO pause is what decides.
    const second = a.push({
      source: "them",
      text: "The usual play to the tide wing and then no escape to need more.",
      timestamp: T + 300 + 3000 + LAG,
      pauseBeforeMs: 300,
    });

    expect(second.kind).toBe("pending");
    expect(a.current?.text).toContain("Thank you");
    expect(a.current?.text).toContain("no escape");
  });

  it("counts exactly one dispatch for such a monologue", () => {
    const a = new QuestionAssembler({ mode: "fast" });
    let emissions = 0;

    for (const [text, timestamp, pauseBeforeMs] of [
      ["Спасибо, что пришли. Обычно я начинаю с общей картины проекта.", T + LAG, 300],
      ["и потом уже перехожу к самым узким местам архитектуры.", T + 300 + 3000 + LAG, 300],
    ] as const) {
      const r = a.push({ source: "them", text, timestamp, pauseBeforeMs });
      if (r.kind === "emitted") emissions += 1;
    }
    const flushed = a.flush("them", { allowContinuation: true });
    if (flushed?.kind === "emitted") emissions += 1;

    expect(emissions).toBe(1);
  });

  it("still starts a new question when the speaker really paused", () => {
    const a = new QuestionAssembler({ mode: "fast" });

    a.push({
      source: "them",
      text: "Tell me about how you handle merge conflicts.",
      timestamp: T + LAG,
      pauseBeforeMs: 300,
    });

    // A real 2s pause in the audio, and a fragment that opens a new question.
    const r = a.push({
      source: "them",
      text: "What tools do you use for CI/CD",
      timestamp: T + 2000 + LAG,
      pauseBeforeMs: 2000,
    });

    expect(r.kind).toBe("emitted");
    if (r.kind === "emitted") {
      expect(r.question).toBe("Tell me about how you handle merge conflicts.");
    }
    expect(a.current?.text).toBe("What tools do you use for CI/CD");
  });
});
