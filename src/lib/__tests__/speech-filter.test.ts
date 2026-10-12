import { describe, it, expect } from "vitest";
import { shouldTriggerAIResponse } from "../speech-filter";

describe("shouldTriggerAIResponse - architecture & design imperatives (R12)", () => {
  it("triggers AI for 'Design Twitter' without question mark (spec scenario)", () => {
    expect(shouldTriggerAIResponse("Design Twitter")).toBe(true);
  });

  it("triggers AI for other English architecture and design imperatives", () => {
    expect(shouldTriggerAIResponse("Design Uber")).toBe(true);
    expect(shouldTriggerAIResponse("Architect YouTube")).toBe(true);
    expect(shouldTriggerAIResponse("Build Spotify")).toBe(true);
    expect(shouldTriggerAIResponse("Implement cache")).toBe(true);
  });

  it("triggers AI for Russian architecture and design imperatives", () => {
    expect(shouldTriggerAIResponse("Спроектируй Twitter")).toBe(true);
    expect(shouldTriggerAIResponse("Разработай мессенджер")).toBe(true);
    expect(shouldTriggerAIResponse("Построй пайплайн")).toBe(true);
  });

  it("still suppresses short fillers and backchannels", () => {
    expect(shouldTriggerAIResponse("угу")).toBe(false);
    expect(shouldTriggerAIResponse("да")).toBe(false);
    expect(shouldTriggerAIResponse("ок")).toBe(false);
    expect(shouldTriggerAIResponse("yeah")).toBe(false);
  });
});
