import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  PromptProfilesSettings,
  isDraftDirty,
} from "./PromptProfilesSettings";
import { PromptProfile } from "@/lib/storage/prompt-profiles";

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const mockSelectPromptProfile = vi.fn();
const mockUpdatePromptProfile = vi.fn();
const mockCreatePromptProfile = vi.fn();
const mockDeletePromptProfile = vi.fn();
const mockResetPromptProfile = vi.fn();
const mockRefreshPromptProfiles = vi.fn();

const profile1: PromptProfile = {
  id: "profile-interview",
  name: "Interview Mode",
  description: "Candidate answers",
  systemPrompt: "Original interview prompt",
  humanizerEnabled: true,
  interviewMode: true,
  customStyle: "",
  ragResumeEnabled: false,
  ragJobEnabled: false,
  isBuiltin: true,
};

const profile2: PromptProfile = {
  id: "profile-general",
  name: "General Mode",
  description: "General assistance",
  systemPrompt: "Original general prompt",
  humanizerEnabled: false,
  interviewMode: false,
  customStyle: "concise",
  ragResumeEnabled: false,
  ragJobEnabled: false,
  isBuiltin: true,
};

vi.mock("@/contexts", () => ({
  useApp: () => ({
    promptProfiles: [profile1, profile2],
    activeProfileId: "profile-interview",
    selectPromptProfile: mockSelectPromptProfile,
    updatePromptProfile: mockUpdatePromptProfile,
    createPromptProfile: mockCreatePromptProfile,
    deletePromptProfile: mockDeletePromptProfile,
    resetPromptProfile: mockResetPromptProfile,
    refreshPromptProfiles: mockRefreshPromptProfiles,
  }),
}));

vi.mock("@/lib/storage/user-facts", () => ({
  getUserFacts: () => [],
  getUserStylePreferences: () => ({}),
  getFeedbackLog: () => [],
  addUserFact: vi.fn(),
  removeUserFact: vi.fn(),
  getUserMarkdownProfile: () => "",
  saveUserMarkdownProfile: vi.fn(),
  resetUserMarkdownProfile: vi.fn(),
}));

vi.mock("@/lib/storage/prompt-profiles", () => ({
  SELF_EVOLUTION_PROFILE_ID: "profile-self-evolution",
  getRemovedBuiltinProfileIds: () => [],
  restoreAllBuiltinProfiles: vi.fn(),
}));

describe("R28: PromptProfilesSettings - profile switch mid-edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isDraftDirty helper", () => {
    it("returns false when draft is null or original is undefined", () => {
      expect(isDraftDirty(null, profile1)).toBe(false);
      expect(isDraftDirty(profile1, undefined)).toBe(false);
      expect(isDraftDirty(null, undefined)).toBe(false);
    });

    it("returns false when draft is identical to original", () => {
      expect(isDraftDirty({ ...profile1 }, profile1)).toBe(false);
    });

    it("returns true when systemPrompt is modified", () => {
      expect(
        isDraftDirty(
          { ...profile1, systemPrompt: "New modified prompt" },
          profile1
        )
      ).toBe(true);
    });

    it("returns true when any boolean toggle or style is modified", () => {
      expect(
        isDraftDirty({ ...profile1, humanizerEnabled: false }, profile1)
      ).toBe(true);
      expect(
        isDraftDirty({ ...profile1, interviewMode: false }, profile1)
      ).toBe(true);
      expect(
        isDraftDirty({ ...profile1, customStyle: "custom tone" }, profile1)
      ).toBe(true);
      expect(
        isDraftDirty({ ...profile1, ragResumeEnabled: true }, profile1)
      ).toBe(true);
      expect(
        isDraftDirty({ ...profile1, ragJobEnabled: true }, profile1)
      ).toBe(true);
    });
  });

  describe("Profile switch state machine in UI", () => {
    it("switches profile immediately without modal when not editing", async () => {
      renderWithRouter(<PromptProfilesSettings />);
      const generalCard = screen.getByText("General Mode");
      await userEvent.click(generalCard);

      expect(mockSelectPromptProfile).toHaveBeenCalledWith("profile-general");
    });

    it("switches profile immediately when editing but draft has no changes", async () => {
      renderWithRouter(<PromptProfilesSettings />);

      // Click Edit profile
      const editButton = screen.getByRole("button", { name: /Edit profile/i });
      await userEvent.click(editButton);

      // Click General Mode card without typing any changes
      const generalCard = screen.getByText("General Mode");
      await userEvent.click(generalCard);

      // Switched directly, no modal shown
      expect(screen.queryByText("Несохранённые изменения")).toBeNull();
      expect(mockSelectPromptProfile).toHaveBeenCalledWith("profile-general");
    });

    it("shows confirmation modal when switching profile with dirty draft", async () => {
      renderWithRouter(<PromptProfilesSettings />);

      // Enter edit mode
      const editButton = screen.getByRole("button", { name: /Edit profile/i });
      await userEvent.click(editButton);

      // Modify the system prompt textarea
      const textarea = screen.getByPlaceholderText(
        "How should the AI behave in this profile?"
      );
      await userEvent.type(textarea, " modified additions");

      // Click the other profile card
      const generalCard = screen.getByText("General Mode");
      await userEvent.click(generalCard);

      // Profile switch should NOT have been called yet
      expect(mockSelectPromptProfile).not.toHaveBeenCalled();

      // Modal should be visible
      expect(screen.getByText("Несохранённые изменения")).toBeDefined();
      expect(
        screen.getByText(/В профиле «Interview Mode» есть несохранённые изменения/)
      ).toBeDefined();
    });

    it("cancels switch and preserves draft when user clicks 'Отмена' in modal", async () => {
      renderWithRouter(<PromptProfilesSettings />);

      const editButton = screen.getByRole("button", { name: /Edit profile/i });
      await userEvent.click(editButton);

      const textarea = screen.getByPlaceholderText(
        "How should the AI behave in this profile?"
      );
      await userEvent.type(textarea, " modified additions");

      const generalCard = screen.getByText("General Mode");
      await userEvent.click(generalCard);

      // Click Cancel in the modal
      const cancelBtn = screen.getByRole("button", { name: "Отмена" });
      await userEvent.click(cancelBtn);

      // Modal should disappear, no switch occurred, draft is still being edited
      expect(screen.queryByText("Несохранённые изменения")).toBeNull();
      expect(mockSelectPromptProfile).not.toHaveBeenCalled();
      expect(mockUpdatePromptProfile).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /Save profile/i })).toBeDefined();
    });

    it("discards draft and switches profile when user clicks 'Не сохранять'", async () => {
      renderWithRouter(<PromptProfilesSettings />);

      const editButton = screen.getByRole("button", { name: /Edit profile/i });
      await userEvent.click(editButton);

      const textarea = screen.getByPlaceholderText(
        "How should the AI behave in this profile?"
      );
      await userEvent.type(textarea, " modified additions");

      const generalCard = screen.getByText("General Mode");
      await userEvent.click(generalCard);

      // Click Discard
      const discardBtn = screen.getByRole("button", { name: "Не сохранять" });
      await userEvent.click(discardBtn);

      // Should not update profile1, but should switch to profile2
      expect(mockUpdatePromptProfile).not.toHaveBeenCalled();
      expect(mockSelectPromptProfile).toHaveBeenCalledWith("profile-general");
    });

    it("saves draft and switches profile when user clicks 'Сохранить и перейти'", async () => {
      renderWithRouter(<PromptProfilesSettings />);

      const editButton = screen.getByRole("button", { name: /Edit profile/i });
      await userEvent.click(editButton);

      const textarea = screen.getByPlaceholderText(
        "How should the AI behave in this profile?"
      );
      await userEvent.type(textarea, " with edits");

      const generalCard = screen.getByText("General Mode");
      await userEvent.click(generalCard);

      // Click Save & Switch
      const saveAndSwitchBtn = screen.getByRole("button", {
        name: "Сохранить и перейти",
      });
      await userEvent.click(saveAndSwitchBtn);

      // Profile 1 should be saved with draft changes
      expect(mockUpdatePromptProfile).toHaveBeenCalledWith(
        "profile-interview",
        expect.objectContaining({
          systemPrompt: "Original interview prompt with edits",
        })
      );
      // And then switch to profile 2
      expect(mockSelectPromptProfile).toHaveBeenCalledWith("profile-general");
    });
  });
});
