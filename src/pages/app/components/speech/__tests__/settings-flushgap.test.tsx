import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsPanel } from "../SettingsPanel";
import { DEFAULT_VAD_CONFIG } from "@/hooks/useSystemAudio";

const updatePromptProfile = vi.fn();

vi.mock("@/contexts", () => ({
  useApp: () => ({
    activeProfileId: "profile-interview",
    updatePromptProfile,
  }),
}));

vi.mock("@/lib/storage/prompt-profiles", () => ({
  getActiveProfile: () => ({ id: "profile-interview", flushGapMs: 450 }),
}));

function openAdvanced() {
  fireEvent.click(screen.getByText("Settings"));
  fireEvent.click(screen.getByText("Advanced Settings"));
}

describe("SettingsPanel flushGap slider", () => {
  beforeEach(() => {
    updatePromptProfile.mockClear();
  });

  const baseProps = {
    vadConfig: DEFAULT_VAD_CONFIG,
    onUpdateVadConfig: vi.fn(),
    useSystemPrompt: false,
    setUseSystemPrompt: vi.fn(),
    contextContent: "",
    setContextContent: vi.fn(),
    respondToMic: false,
    setRespondToMic: vi.fn(),
  };

  it("показывает текущую паузу из активного профиля", () => {
    render(<SettingsPanel {...baseProps} />);
    openAdvanced();
    expect(screen.getByText("Пауза перед ответом")).toBeInTheDocument();
    expect(screen.getByText("0.5s")).toBeInTheDocument();
  });

  it("слайдер пишет flushGapMs в активный профиль (живое применение через reconfigure)", () => {
    render(<SettingsPanel {...baseProps} />);
    openAdvanced();
    const slider = screen
      .getAllByRole("slider")
      .find((s) => s.getAttribute("aria-valuenow") === "450");
    expect(slider).toBeDefined();
    fireEvent.keyDown(slider!, { key: "ArrowRight" });
    expect(updatePromptProfile).toHaveBeenCalledWith(
      "profile-interview",
      expect.objectContaining({ flushGapMs: expect.any(Number) })
    );
  });
});
