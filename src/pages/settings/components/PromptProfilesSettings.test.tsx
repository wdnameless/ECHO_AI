import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  PromptProfilesSettings,
  isDraftDirty,
} from "./PromptProfilesSettings";
import type { PromptProfile } from "@/lib/storage/prompt-profiles";
import { resetLearning, saveUserMarkdownProfile } from "@/lib/storage/user-facts";

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

const mockUseAppState: { profiles: PromptProfile[]; activeId: string } = {
  profiles: [profile1, profile2],
  activeId: "profile-interview",
};

vi.mock("@/contexts", () => ({
  useApp: () => ({
    promptProfiles: mockUseAppState.profiles,
    activeProfileId: mockUseAppState.activeId,
    selectPromptProfile: mockSelectPromptProfile,
    updatePromptProfile: mockUpdatePromptProfile,
    createPromptProfile: mockCreatePromptProfile,
    deletePromptProfile: mockDeletePromptProfile,
    resetPromptProfile: mockResetPromptProfile,
    refreshPromptProfiles: mockRefreshPromptProfiles,
  }),
}));

vi.mock("@/lib/storage/user-facts", () => ({
  getUserFacts: () => [
    {
      id: "fact-1",
      category: "role",
      fact: "Senior Engineer",
      confidence: 1,
      source: "manual",
      timestamp: 1000,
    },
  ],
  getUserStylePreferences: () => ({
    tone: "живой",
    preferredLength: "concise",
    favoritePatterns: ["Объяснять ход мыслей"],
    avoidPatterns: ["Маркированные списки"],
    customRules: [
      "Кратко и по сути",
      "отвечай прямо без общих слов",
      "Начинай ответ сразу с сути",
    ],
  }),
  saveUserStylePreferences: vi.fn(),
  addUserRule: vi.fn(),
  getRuleSource: (rule: string) =>
    rule === "отвечай прямо без общих слов"
      ? "coach"
      : rule === "Начинай ответ сразу с сути"
      ? "feedback"
      : "manual",
  getFeedbackLog: () => [
    {
      id: "fb-1",
      question: "Как работает GC?",
      response: "GC очищает память...",
      rating: "like",
      reason: "Хороший ответ",
      timestamp: 2000,
    },
    {
      id: "fb-coach-1",
      question: "Рекомендация собеседника",
      response: "Углубись в один пример",
      rating: "like",
      topic: "coach",
      reason: "Взято как правило из реплики собеседника (source=coach)",
      timestamp: 3000,
    },
    {
      id: "fb-manual-1",
      question: "Добавление правила",
      response: "Ручное правило",
      rating: "like",
      topic: "manual",
      reason: "Добавлено пользователем в редакторе (source=manual)",
      timestamp: 2500,
    },
  ],
  saveFeedbackLog: vi.fn(),
  addUserFact: vi.fn(),
  removeUserFact: vi.fn(),
  getUserMarkdownProfile: () => "# USER.md",
  saveUserMarkdownProfile: vi.fn(),
  resetUserMarkdownProfile: vi.fn(),
  resetLearning: vi.fn().mockResolvedValue(undefined),
  isSelfLearningEnabled: () => true,
  setSelfLearningEnabled: vi.fn(),
}));

vi.mock("@/lib/storage/prompt-profiles", () => ({
  SELF_EVOLUTION_PROFILE_ID: "profile-self-evolution",
  getRemovedBuiltinProfileIds: () => [],
  restoreAllBuiltinProfiles: vi.fn(),
  exportProfileToJson: vi.fn((p) => JSON.stringify(p)),
  exportProfilesToJson: vi.fn((ps) => JSON.stringify(ps)),
  importProfilesFromJson: vi.fn((json: string) => {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }),
}));

vi.mock("@/lib/storage/smart-rules", () => ({
  getSmartRules: () => [
    {
      id: "smart-1",
      text: "отвечай прямо без общих слов",
      weight: 1.0,
      scope: { kind: "global" },
      hits: 7,
      createdAt: 1000,
      lastHitAt: 2000,
      ttlDays: 30,
      archived: false,
      origin: { source: "coach", quote: "прямо без общих слов", at: 1000 },
    },
    {
      id: "smart-2",
      text: "Начинай ответ сразу с сути",
      weight: 0.8,
      scope: { kind: "global" },
      hits: 3,
      createdAt: 1000,
      lastHitAt: 2000,
      ttlDays: 30,
      archived: false,
      origin: { source: "feedback", quote: "сразу с сути", at: 1000 },
    },
    {
      id: "smart-3",
      text: "Кратко и по сути",
      weight: 1.0,
      scope: { kind: "global" },
      hits: 12,
      createdAt: 1000,
      lastHitAt: 2000,
      ttlDays: 30,
      archived: false,
      origin: { source: "manual", quote: "Кратко", at: 1000 },
    },
  ],
  deleteSmartRule: vi.fn(),
  saveSmartRule: vi.fn(),
  archiveSmartRule: vi.fn(),
  findConflictingRule: (text: string) =>
    text.toLowerCase().includes("подробно")
      ? {
          id: "smart-3",
          text: "Кратко и по сути",
          weight: 1.0,
          scope: { kind: "global" },
          hits: 12,
          createdAt: 1000,
          lastHitAt: 2000,
          ttlDays: 30,
          archived: false,
          origin: { source: "manual", quote: "Кратко", at: 1000 },
        }
      : null,
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

    it("returns true when flushGapMs, defaultLength, visibleButtons, or monologue is modified", () => {
      expect(
        isDraftDirty({ ...profile1, flushGapMs: 1200 }, profile1)
      ).toBe(true);
      expect(
        isDraftDirty({ ...profile1, defaultLength: "long" }, profile1)
      ).toBe(true);
      expect(
        isDraftDirty({ ...profile1, visibleButtons: ["answer", "settings"] }, profile1)
      ).toBe(true);
      expect(
        isDraftDirty(
          { ...profile1, monologue: { mode: "semi", maxWindow: 20000 } },
          profile1
        )
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

describe("T2 & T5: Self-Learning toggle and editors in PromptProfilesSettings", () => {
  const evolutionProfile: PromptProfile = {
    id: "profile-self-evolution",
    name: "Self-Evolution ✨",
    description: "Adaptive assistant",
    systemPrompt: "Adaptive prompt",
    humanizerEnabled: true,
    interviewMode: false,
    customStyle: "",
    ragResumeEnabled: false,
    ragJobEnabled: false,
    isBuiltin: true,
  };

  it("renders self-learning toggle and knowledge base panel when evolution profile is active", () => {
    mockUseAppState.profiles = [profile1, profile2, evolutionProfile];
    mockUseAppState.activeId = "profile-self-evolution";
    try {
      renderWithRouter(<PromptProfilesSettings />);
      expect(screen.getByText("Самообучение ассистента")).toBeInTheDocument();
      expect(screen.getByText("Senior Engineer")).toBeInTheDocument();
      expect(screen.getByText("Объяснять ход мыслей")).toBeInTheDocument();
      expect(screen.getByText("Маркированные списки")).toBeInTheDocument();
      expect(screen.getByText("Кратко и по сути")).toBeInTheDocument();
      expect(screen.getByText(/Журнал обучения/)).toBeInTheDocument();
      expect(screen.getByText("Как работает GC?")).toBeInTheDocument();
    } finally {
      mockUseAppState.profiles = [profile1, profile2];
      mockUseAppState.activeId = "profile-interview";
    }
  });

  it("displays source badges (coach/manual/feedback) in both the custom rules editor and journal", () => {
    mockUseAppState.profiles = [profile1, profile2, evolutionProfile];
    mockUseAppState.activeId = "profile-self-evolution";
    try {
      renderWithRouter(<PromptProfilesSettings />);
      const ruleBadges = screen.getAllByTestId("rule-source-badge").map((el) => el.textContent?.trim());
      expect(ruleBadges).toEqual(expect.arrayContaining(["coach", "manual", "feedback"]));

      const journalBadges = screen.getAllByTestId("journal-source-badge").map((el) => el.textContent?.trim());
      expect(journalBadges.some((t) => t?.includes("coach"))).toBe(true);
      expect(journalBadges.some((t) => t?.includes("manual"))).toBe(true);
      expect(journalBadges.some((t) => t?.includes("feedback"))).toBe(true);
    } finally {
      mockUseAppState.profiles = [profile1, profile2];
      mockUseAppState.activeId = "profile-interview";
    }
  });
});

describe("R09: ProfileCards and 3-step ProfileWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders profile cards with name, description, and badges", () => {
    renderWithRouter(<PromptProfilesSettings />);
    expect(screen.getAllByText("Interview Mode").length).toBeGreaterThan(0);
    expect(screen.getByText("General Mode")).toBeInTheDocument();
    expect(screen.getByText("Candidate answers")).toBeInTheDocument();
    expect(screen.getAllByText("built-in").length).toBeGreaterThan(0);
  });

  it("creates a new profile through the 3-step wizard", async () => {
    mockCreatePromptProfile.mockReturnValue({
      id: "profile-new-wizard",
      name: "System Design Round",
      description: "Architecture answers",
      systemPrompt: "You are an architecture expert",
      humanizerEnabled: true,
      interviewMode: false,
      customStyle: "",
      ragResumeEnabled: false,
      ragJobEnabled: false,
      flushGapMs: 1000,
      defaultLength: "auto",
      visibleButtons: [],
    });

    renderWithRouter(<PromptProfilesSettings />);

    // Open wizard
    const newProfileBtn = screen.getByRole("button", { name: /New profile/i });
    await userEvent.click(newProfileBtn);

    // Step 1: Name and description
    expect(screen.getByTestId("wizard-step-1")).toBeInTheDocument();
    const nameInput = screen.getByPlaceholderText(/Profile name/i);
    await userEvent.type(nameInput, "System Design Round");

    const nextBtn1 = screen.getByRole("button", { name: /Далее/i });
    await userEvent.click(nextBtn1);

    // Step 2: Prompt
    expect(screen.getByTestId("wizard-step-2")).toBeInTheDocument();
    const nextBtn2 = screen.getByRole("button", { name: /Далее/i });
    await userEvent.click(nextBtn2);

    // Step 3: Behavior & buttons
    expect(screen.getByTestId("wizard-step-3")).toBeInTheDocument();
    const finishBtn = screen.getByRole("button", { name: /Создать профиль/i });
    await userEvent.click(finishBtn);

    expect(mockCreatePromptProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "System Design Round",
      })
    );
    expect(mockSelectPromptProfile).toHaveBeenCalledWith("profile-new-wizard");
  });
});

describe("R10: Profile prompt preview and RulesPanel with weights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("switches to prompt preview tab and displays assembled system prompt", async () => {
    renderWithRouter(<PromptProfilesSettings />);

    const previewTabBtn = screen.getByRole("button", { name: /Превью промпта/i });
    await userEvent.click(previewTabBtn);

    expect(screen.getByTestId("profile-prompt-preview")).toBeInTheDocument();
    expect(screen.getByText(/Итоговый системный промпт/i)).toBeInTheDocument();
    expect(screen.getByText(/CONVERSATIONAL FILTER RULE/i)).toBeInTheDocument();
  });

  it("displays smart rules with weight badges and handles conflicting rules", async () => {
    const evolutionProfile: PromptProfile = {
      id: "profile-self-evolution",
      name: "Self-Evolution ✨",
      description: "Adaptive assistant",
      systemPrompt: "Adaptive prompt",
      humanizerEnabled: true,
      interviewMode: false,
      customStyle: "",
      ragResumeEnabled: false,
      ragJobEnabled: false,
      isBuiltin: true,
    };

    mockUseAppState.profiles = [profile1, profile2, evolutionProfile];
    mockUseAppState.activeId = "profile-self-evolution";

    try {
      renderWithRouter(<PromptProfilesSettings />);
      expect(screen.getByTestId("rules-panel")).toBeInTheDocument();
      const weightBadges = screen.getAllByTestId("rule-weight-badge");
      expect(weightBadges.length).toBeGreaterThan(0);

      // Add conflicting rule (e.g. contains "подробно")
      const ruleInput = screen.getByPlaceholderText(/Add custom rule/i);
      await userEvent.type(ruleInput, "Отвечай максимально подробно");
      const addBtn = screen.getAllByRole("button", { name: "Add" }).find((b) =>
        b.closest('[data-testid="rules-panel"]')
      );
      if (addBtn) {
        await userEvent.click(addBtn);
      }

      // Conflict warning should appear
      expect(screen.getByText("Обнаружено противоречие правил")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Заменить старое" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Оставить оба" })).toBeInTheDocument();
    } finally {
      mockUseAppState.profiles = [profile1, profile2];
      mockUseAppState.activeId = "profile-interview";
    }
  });
});

describe("R11: Preserved operations (CRUD, Export/Import, Facts, USER.md, Reset)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens JSON import modal when clicking 'Импорт'", async () => {
    renderWithRouter(<PromptProfilesSettings />);

    const importBtn = screen.getByRole("button", { name: /Импорт/i });
    await userEvent.click(importBtn);

    expect(screen.getByText(/Импорт профилей/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Custom Profile/i)).toBeInTheDocument();
  });

  it("triggers reset learning and resets memory state", async () => {
    const evolutionProfile: PromptProfile = {
      id: "profile-self-evolution",
      name: "Self-Evolution ✨",
      description: "Adaptive assistant",
      systemPrompt: "Adaptive prompt",
      humanizerEnabled: true,
      interviewMode: false,
      customStyle: "",
      ragResumeEnabled: false,
      ragJobEnabled: false,
      isBuiltin: true,
    };

    mockUseAppState.profiles = [profile1, profile2, evolutionProfile];
    mockUseAppState.activeId = "profile-self-evolution";

    try {
      renderWithRouter(<PromptProfilesSettings />);

      const resetBtn = screen.getByTitle("Reset all learned memory and feedback");
      await userEvent.click(resetBtn);

      expect(resetLearning).toHaveBeenCalled();
    } finally {
      mockUseAppState.profiles = [profile1, profile2];
      mockUseAppState.activeId = "profile-interview";
    }
  });

  it("toggles USER.md editor and saves markdown profile", async () => {
    const evolutionProfile: PromptProfile = {
      id: "profile-self-evolution",
      name: "Self-Evolution ✨",
      description: "Adaptive assistant",
      systemPrompt: "Adaptive prompt",
      humanizerEnabled: true,
      interviewMode: false,
      customStyle: "",
      ragResumeEnabled: false,
      ragJobEnabled: false,
      isBuiltin: true,
    };

    mockUseAppState.profiles = [profile1, profile2, evolutionProfile];
    mockUseAppState.activeId = "profile-self-evolution";

    try {
      renderWithRouter(<PromptProfilesSettings />);

      const userMdToggleBtn = screen.getByRole("button", { name: /USER.md Editor/i });
      await userEvent.click(userMdToggleBtn);

      expect(screen.getByText(/USER.md Context Profile/i)).toBeInTheDocument();
      const saveMdBtn = screen.getByRole("button", { name: /Save USER.md/i });
      await userEvent.click(saveMdBtn);

      expect(saveUserMarkdownProfile).toHaveBeenCalled();
    } finally {
      mockUseAppState.profiles = [profile1, profile2];
      mockUseAppState.activeId = "profile-interview";
    }
  });
});
