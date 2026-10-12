import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  extractSpeechStyle,
  recordUserSpeech,
  getUserSpeechTranscripts,
  type SpeechStyle,
} from "../speech-style";
import {
  buildSelfEvolutionPromptBlock,
  resetLearning,
  setSelfLearningEnabled,
} from "../storage/user-facts";
import { useConversationStore } from "@/hooks/useConversationStore";
import { saveFillerFilterConfig } from "../filler-filter";

describe("T4: speech-style & personal filler learning (R03, R04)", () => {
  beforeEach(async () => {
    localStorage.clear();
    setSelfLearningEnabled(true);
    await resetLearning();
  });

  it("extractSpeechStyle counts fillers from ALL_DEFAULT_FILLERS, conversational markers, and stretched fillers up to top-8", () => {
    const transcripts = [
      "Ну, типа, по факту мы сделали кэш, смотрите, ммм, это работает.",
      "Смотрите, по факту тут короче как бы два сервиса, эээ, ну и очередь.",
      "По факту, смотрите, ну типа короче вот так, хммм, гм, аааа.",
      "You know, um, I mean, uh-huh, mhm, mm-hmm, угу.",
    ];

    const style: SpeechStyle = extractSpeechStyle(transcripts);
    expect(style.fillers.length).toBeLessThanOrEqual(8);
    expect(style.fillers.length).toBeGreaterThan(0);

    const words = style.fillers.map((f) => f.word);
    expect(words).toContain("по факту");
    expect(words).toContain("смотрите");
    expect(words).toContain("ну");
    expect(words).toContain("типа");
    expect(words).toContain("короче");

    // Sorted descending by count
    for (let i = 1; i < style.fillers.length; i++) {
      expect(style.fillers[i - 1].count).toBeGreaterThanOrEqual(
        style.fillers[i].count
      );
    }
  });

  it("extractSpeechStyle detects stretched hesitation sounds (isStretchedFiller heuristic) and caps at 8", () => {
    const transcripts = [
      "ээээ мммм аааа уууу хммм нууу тииипа",
      "ну типа короче как бы вот эм хм гм мм you know i mean um uh",
    ];
    const style = extractSpeechStyle(transcripts);
    expect(style.fillers.length).toBe(8);

    const stretchedOnly = extractSpeechStyle(["мммм ээээ аааа мммм ээээ"]);
    expect(stretchedOnly.fillers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ word: "мммм", count: 2 }),
        expect.objectContaining({ word: "ээээ", count: 2 }),
      ])
    );
  });

  it("buildSelfEvolutionPromptBlock includes 'Речевые маркеры пользователя' section with cap of 3 when learning is enabled", () => {
    recordUserSpeech("По факту, смотрите, мы шардировали базу данных.");
    recordUserSpeech("Смотрите, по факту ну короче это дало прирост.");

    const block = buildSelfEvolutionPromptBlock();
    expect(block).toContain("Речевые маркеры пользователя");
    expect(block).toContain("по факту");
    expect(block).toContain("смотрите");
    expect(block).toContain("не более 3 маркеров");
    expect(block).toMatch(/свободной.*форме/i);

    setSelfLearningEnabled(false);
    expect(buildSelfEvolutionPromptBlock()).toBe("");
  });

  it("addInteraction(source='me') stores raw unfiltered speech in speech log (separate from feedback log)", () => {
    // Even if fillerAiEnabled is turned on manually, raw speech must be recorded for style learning
    saveFillerFilterConfig({ filterAiEnabled: true });

    const { result } = renderHook(() => useConversationStore());

    act(() => {
      result.current.addInteraction(
        "Ну, типа, по факту я писал сервисы на Go, смотрите",
        "Отличный опыт!",
        "me"
      );
      result.current.addInteraction(
        "Ну расскажи про каналы",
        "Каналы в Go...",
        "them"
      );
    });

    const speechLog = getUserSpeechTranscripts();
    expect(speechLog).toHaveLength(1);
    expect(speechLog[0]).toBe(
      "Ну, типа, по факту я писал сервисы на Go, смотрите"
    );
  });
});
