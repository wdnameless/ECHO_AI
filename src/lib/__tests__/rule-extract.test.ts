import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractRuleCandidate, refineRuleCandidate } from "../rule-extract";
import { fetchAIResponse } from "../functions/ai-response.function";

vi.mock("../functions/ai-response.function", () => ({
  fetchAIResponse: vi.fn(),
}));

describe("rule-extract (F1 T1 / R01-R02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractRuleCandidate (sync heuristics, R01-R02)", () => {
    it("spec scenario: strips fillers/vocatives and normalizes imperatives to infinitives", () => {
      const input = "Ну, кстати, давай углубись в один пример, отвечай прямо";
      expect(extractRuleCandidate(input)).toBe(
        "углубляться в один пример, отвечать прямо"
      );
    });

    it("strips heavy ASR filler mess, stutters, and conversational openers", () => {
      const input =
        "Эээ, ну, слушай, короче, типа, как бы давай давай говори короче и не лей воду, пожалуйста";
      expect(extractRuleCandidate(input)).toBe(
        "говорить короче и не лить воду"
      );
    });

    it("normalizes coaching imperatives across multiple clauses", () => {
      const input =
        "Смотри, расскажи подробнее про архитектуру, приведи пример кода";
      expect(extractRuleCandidate(input)).toBe(
        "рассказать подробнее про архитектуру, привести пример кода"
      );
    });

    it("caps extracted candidate at 12 words maximum", () => {
      const input =
        "Ну слушай, давай отвечай всегда очень коротко по делу в два три предложения без длинных теоретических вступлений и лишних рассуждений";
      const result = extractRuleCandidate(input);
      const words = result.split(/\s+/).filter(Boolean);
      expect(words.length).toBeLessThanOrEqual(12);
      expect(result).toMatch(/^отвечать всегда очень коротко/);
    });

    it("returns empty string when input contains only fillers or whitespace", () => {
      expect(extractRuleCandidate("   ")).toBe("");
      expect(extractRuleCandidate("Ну, эээ, короче, слушай, типа...")).toBe("");
    });
  });

  describe("refineRuleCandidate (async LLM background refine, R02)", () => {
    it("refines rule via provider stream and strips markdown/quotes", async () => {
      vi.mocked(fetchAIResponse).mockReturnValue(
        (async function* () {
          yield "«углубляться в один пример, ";
          yield "отвечать прямо без воды»";
        })()
      );

      const refined = await refineRuleCandidate(
        "углубляться в один пример, отвечать прямо"
      );
      expect(fetchAIResponse).toHaveBeenCalledTimes(1);
      expect(refined).toBe("углубляться в один пример, отвечать прямо без воды");
    });

    it("caps LLM refined output at 12 words", async () => {
      vi.mocked(fetchAIResponse).mockReturnValue(
        (async function* () {
          yield "углубляться в один конкретный пример из практики и всегда отвечать максимально прямо без лишней теоретической воды";
        })()
      );

      const refined = await refineRuleCandidate("углубляться в один пример");
      const words = refined.split(/\s+/).filter(Boolean);
      expect(words.length).toBeLessThanOrEqual(12);
    });

    it("falls back to sync heuristic candidate when provider call fails", async () => {
      vi.mocked(fetchAIResponse).mockImplementation(async function* () {
        throw new Error("Provider offline");
      });

      const refined = await refineRuleCandidate(
        "Ну, кстати, давай углубись в один пример, отвечай прямо"
      );
      expect(refined).toBe("углубляться в один пример, отвечать прямо");
    });
  });
});
