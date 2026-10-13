import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import React, { useRef } from "react";
import {
  useProfilesStore,
  useAudioStore,
  useStealthStore,
  useHistoryStore,
} from "../index";

describe("S2: Zustand domain stores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useProfilesStore", () => {
    it("manages prompt profiles and active profile selection", () => {
      const state = useProfilesStore.getState();
      expect(state.promptProfiles.length).toBeGreaterThan(0);
      expect(state.activeProfileId).toBeDefined();

      const newProfile = state.createPromptProfile({
        name: "Test Profile",
        description: "Test description",
        systemPrompt: "You are a test assistant.",
        humanizerEnabled: false,
        interviewMode: false,
        customStyle: "",
        ragResumeEnabled: false,
        ragJobEnabled: false,
      });

      expect(newProfile.id).toBeDefined();
      expect(
        useProfilesStore.getState().promptProfiles.some((p) => p.id === newProfile.id)
      ).toBe(true);

      useProfilesStore.getState().selectPromptProfile(newProfile.id);
      expect(useProfilesStore.getState().activeProfileId).toBe(newProfile.id);
      expect(useProfilesStore.getState().systemPrompt).toBe("You are a test assistant.");

      useProfilesStore.getState().updatePromptProfile(newProfile.id, {
        systemPrompt: "Updated prompt",
      });
      expect(useProfilesStore.getState().systemPrompt).toBe("Updated prompt");

      useProfilesStore.getState().deletePromptProfile(newProfile.id);
      expect(
        useProfilesStore.getState().promptProfiles.some((p) => p.id === newProfile.id)
      ).toBe(false);
    });

    it("manages job profiles and updates", () => {
      const state = useProfilesStore.getState();
      const newJob = state.createJobProfile({
        name: "Backend Engineer",
        description: "Backend candidate",
        contextContent: "Experienced engineer",
      });

      expect(newJob.id).toBeDefined();
      expect(
        useProfilesStore.getState().jobProfiles.some((p) => p.id === newJob.id)
      ).toBe(true);

      state.selectJobProfile(newJob.id);
      expect(useProfilesStore.getState().activeJobProfileId).toBe(newJob.id);

      state.deleteJobProfile(newJob.id);
      expect(
        useProfilesStore.getState().jobProfiles.some((p) => p.id === newJob.id)
      ).toBe(false);
    });
  });

  describe("useAudioStore", () => {
    it("updates selected audio devices and STT providers", () => {
      const { setSelectedAudioDevices, onSetSelectedSttProvider } =
        useAudioStore.getState();

      act(() => {
        setSelectedAudioDevices({
          input: { id: "mic-1", name: "External Microphone" },
          output: { id: "speaker-1", name: "Headphones" },
        });
      });

      expect(useAudioStore.getState().selectedAudioDevices.input.id).toBe("mic-1");
      expect(useAudioStore.getState().selectedAudioDevices.output.id).toBe("speaker-1");

      act(() => {
        onSetSelectedSttProvider({
          provider: "handy-local-whisper",
          variables: { model: "base" },
        });
      });

      expect(useAudioStore.getState().selectedSttProvider.provider).toBe(
        "handy-local-whisper"
      );
      expect(useAudioStore.getState().selectedSttProvider.variables.model).toBe("base");
    });
  });

  describe("useStealthStore", () => {
    it("handles stealth and customizable mutations", async () => {
      const { setCursorType, toggleStealthMode } = useStealthStore.getState();

      act(() => {
        setCursorType("invisible");
      });
      expect(useStealthStore.getState().customizable.cursor.type).toBe("invisible");

      await act(async () => {
        await toggleStealthMode(true);
      });
      expect(useStealthStore.getState().customizable.stealth.isEnabled).toBe(true);
    });
  });

  describe("useHistoryStore", () => {
    it("tracks search and deletion workflow", () => {
      const state = useHistoryStore.getState();

      act(() => {
        state.setSearch("interview");
      });
      expect(useHistoryStore.getState().search).toBe("interview");

      act(() => {
        state.handleDeleteConfirm("conv-123");
      });
      expect(useHistoryStore.getState().deleteConfirm).toBe("conv-123");

      act(() => {
        state.cancelDelete();
      });
      expect(useHistoryStore.getState().deleteConfirm).toBeNull();
    });
  });

  describe("Scenario: Аудио-тик не ререндерит настройки", () => {
    it("does not re-render settings components when audio updates arrive", () => {
      let settingsRenderCount = 0;

      const SettingsProbeComponent: React.FC = () => {
        const activeProfileId = useProfilesStore((s) => s.activeProfileId);
        const stealth = useStealthStore((s) => s.customizable.stealth.isEnabled);
        const rendersRef = useRef(0);
        rendersRef.current += 1;
        settingsRenderCount = rendersRef.current;

        return (
          <div data-testid="settings-probe">
            {activeProfileId}-{String(stealth)}
          </div>
        );
      };

      render(<SettingsProbeComponent />);
      expect(settingsRenderCount).toBe(1);

      // Simulate incoming audio ticks and device changes
      act(() => {
        useAudioStore.getState().setSelectedAudioDevices({
          input: { id: `mic-tick-${Date.now()}`, name: "Streaming Mic" },
          output: { id: "out-1", name: "Default" },
        });
      });

      // Settings render count MUST remain 1: no stray re-renders
      expect(settingsRenderCount).toBe(1);

      act(() => {
        useAudioStore.getState().onSetSelectedSttProvider({
          provider: "handy-local-whisper",
          variables: { tick: "123" },
        });
      });

      // Still 1: audio updates isolated to useAudioStore
      expect(settingsRenderCount).toBe(1);
    });
  });
});
