import { describe, it, expect } from "vitest";
import { detectLanguage } from "../language-detect";

describe("detectLanguage", () => {
  it("detects Russian when question contains Russian stop words/markers despite English technical terms (R11)", () => {
    // Spec scenario: «Расскажи про PostgreSQL connection pooling, Kubernetes Ingress и Grafana»
    expect(
      detectLanguage("Расскажи про PostgreSQL connection pooling, Kubernetes Ingress и Grafana")
    ).toBe("russian");
  });

  it("detects Russian for other technical questions with Russian markers", () => {
    expect(detectLanguage("Как работает Go scheduler under high load?")).toBe("russian");
    expect(detectLanguage("Объясни distributed tracing с OpenTelemetry")).toBe("russian");
    expect(detectLanguage("Подскажи best practices для Docker multi-stage builds")).toBe("russian");
  });

  it("detects English for purely English technical queries", () => {
    expect(
      detectLanguage("Tell me about PostgreSQL connection pooling, Kubernetes Ingress and Grafana")
    ).toBe("english");
  });

  it("detects English for English with occasional foreign words without Russian stopwords", () => {
    expect(detectLanguage("This is a test, мир")).toBe("english");
  });

  it("returns null for empty or non-letter text", () => {
    expect(detectLanguage("")).toBe(null);
    expect(detectLanguage("   ")).toBe(null);
    expect(detectLanguage("12345 !?")).toBe(null);
  });
});
