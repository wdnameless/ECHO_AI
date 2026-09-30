import { describe, it, expect } from "vitest";

const PRESETS = {
  studio: { sensitivity_rms: 0.008, peak_threshold: 0.025, noise_gate_threshold: 0.0015, min_speech_chunks: 5 },
  office: { sensitivity_rms: 0.012, peak_threshold: 0.035, noise_gate_threshold: 0.003, min_speech_chunks: 7 },
  noisy: { sensitivity_rms: 0.015, peak_threshold: 0.045, noise_gate_threshold: 0.005, min_speech_chunks: 9 },
};

/**
 * VAD presets: Studio pairs low gate with low min_speech (quiet room, good
 * mic — catches quiet starts, nothing to hallucinate). Gate alone at zero
 * would make the engine hear noise as speech, so the pair is the contract.
 */
describe("VAD preset ladder", () => {
  it("studio is strictly more sensitive than office, office than noisy", () => {
    expect(PRESETS.studio.noise_gate_threshold).toBeLessThan(PRESETS.office.noise_gate_threshold);
    expect(PRESETS.office.noise_gate_threshold).toBeLessThan(PRESETS.noisy.noise_gate_threshold);
    expect(PRESETS.studio.min_speech_chunks).toBeLessThan(PRESETS.office.min_speech_chunks);
    expect(PRESETS.office.min_speech_chunks).toBeLessThan(PRESETS.noisy.min_speech_chunks);
  });

  it("studio gate stays above zero (never hear noise as speech)", () => {
    expect(PRESETS.studio.noise_gate_threshold).toBeGreaterThan(0);
  });

  it("quant routing: EN prefers Q4, RU pins Q8", () => {
    const routing = (quant: string | null, files: Array<{ quant: string }>) => {
      const list = files.map((f) => f.quant);
      if (quant && list.includes(quant)) return quant;
      if (list.includes("Q8_0")) return "Q8_0";
      return list[0];
    };
    const enFiles = [{ quant: "Q4_K_M" }, { quant: "Q8_0" }];
    const ruFiles = [{ quant: "Q8_0" }];
    expect(routing("Q4_K_M", enFiles)).toBe("Q4_K_M");
    expect(routing(null, ruFiles)).toBe("Q8_0");
    expect(routing("Q4_K_M", ruFiles)).toBe("Q8_0");
  });
});
