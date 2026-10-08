import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SystemAudio } from "../index";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: class {},
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    innerSize: () => Promise.resolve({ width: 800, height: 600 }),
    setSize: () => Promise.resolve(),
    listen: () => Promise.resolve(() => {}),
  }),
}));

const mockOnSetSelectedAIProvider = vi.fn();
let mockActiveProfileId = "profile-interview";
let mockPromptProfiles = [
  {
    id: "profile-interview",
    name: "Interview",
    systemPrompt: "test",
    humanizerEnabled: true,
    interviewMode: true,
    customStyle: "",
    ragResumeEnabled: true,
    ragJobEnabled: true,
    visibleButtons: [
      "length",
      "thought",
      "answer",
      "screenshot",
      "audio_settings",
      "settings",
      "new_chat",
    ],
  },
  {
    id: "profile-livecode",
    name: "Livecode",
    systemPrompt: "test",
    humanizerEnabled: true,
    interviewMode: true,
    customStyle: "",
    ragResumeEnabled: false,
    ragJobEnabled: false,
    visibleButtons: [
      "length",
      "thought",
      "livecode",
      "code_plan",
      "code_full",
      "code_screen",
      "answer",
      "screenshot",
      "audio_settings",
      "settings",
      "new_chat",
    ],
  },
  {
    id: "profile-general",
    name: "General",
    systemPrompt: "test",
    humanizerEnabled: true,
    interviewMode: false,
    customStyle: "",
    ragResumeEnabled: false,
    ragJobEnabled: false,
    visibleButtons: [
      "length",
      "thought",
      "answer",
      "monologue_send",
      "screenshot",
      "audio_settings",
      "settings",
      "new_chat",
    ],
  },
];

vi.mock("@/contexts", () => ({
  useApp: () => ({
    hasActiveLicense: true,
    supportsImages: true,
    promptProfiles: mockPromptProfiles,
    activeProfileId: mockActiveProfileId,
    selectPromptProfile: vi.fn(),
    selectedAIProvider: { provider: "openai", variables: { model: "gpt-4o" } },
    onSetSelectedAIProvider: mockOnSetSelectedAIProvider,
    allAiProviders: [
      { id: "openai", curl: 'curl "https://api.openai.com/v1" -d \'{"model":"gpt-4o"}\'' },
      { id: "anthropic", curl: 'curl "https://api.anthropic.com/v1" -d \'{"model":"claude-3-5-sonnet"}\'' },
    ],
  }),
}));

vi.mock("@/lib/version", () => ({
  useAppVersion: () => "1.0.0",
}));

vi.mock("@/lib/entitlements", () => ({
  canUseFeature: () => true,
  isDevBuild: () => false,
}));

vi.mock("../ResultsSection", () => ({
  ResultsSection: (props: { activeProviderId?: string }) => (
    <div data-testid="results-section" data-active-provider={props.activeProviderId}>
      Results
    </div>
  ),
}));

vi.mock("../SettingsPanel", () => ({
  SettingsPanel: () => <div data-testid="settings-panel">Settings</div>,
}));

vi.mock("../RecordingPanel", () => ({
  RecordingPanel: () => <div data-testid="recording-panel">Recording</div>,
}));

vi.mock("../PermissionFlow", () => ({
  PermissionFlow: () => null,
}));

function createProps(): React.ComponentProps<typeof SystemAudio> {
  return {
    askAIForTranscript: vi.fn(),
    clearError: vi.fn(),
    stopCapture: vi.fn(),
    handleSetup: vi.fn(),
    isMicProcessing: false,
    isSystemProcessing: false,
    lastTranscription: "",
    liveSegments: [],
    activeFiller: null,
    pendingUtteranceId: null,
    capturing: true,
    error: "",
    isProcessing: false,
    isAIProcessing: false,
    myLastTranscription: "",
    theirLastTranscription: "Can you implement quicksort?",
    lastAIResponse: "",
    conversation: { id: "1", title: "Test", messages: [], createdAt: 0, updatedAt: 0 },
    recordingProgress: 0,
    vadConfig: {
      enabled: true,
      hop_size: 1024,
      sensitivity_rms: 0.012,
      peak_threshold: 0.035,
      silence_chunks: 12,
      min_speech_chunks: 7,
      pre_speech_chunks: 12,
      noise_gate_threshold: 0.003,
      max_recording_duration_secs: 180,
    },
    useSystemPrompt: true,
    contextContent: "",
    isContinuousMode: false,
    setIsContinuousMode: vi.fn(),
    isRecordingInContinuousMode: false,
    setupRequired: false,
    setIsPopoverOpen: vi.fn(),
    setUseSystemPrompt: vi.fn(),
    setContextContent: vi.fn(),
    updateVadConfiguration: vi.fn(),
    startCapture: vi.fn(),
    startContinuousRecording: vi.fn(),
    startNewConversation: vi.fn(),
    setPendingScreenshot: vi.fn(),
    resizeWindow: vi.fn(),
    autoAskMode: "auto",
    setAutoAskMode: vi.fn(),
    answerLastInterviewerUtterance: vi.fn(),
    answerCodeForLastUtterance: vi.fn(),
    speechModelLang: "ru",
    speechModelSwitching: false,
    onSpeechModelSwitch: vi.fn(),
    answerLengthOverride: "auto",
    onAnswerLengthOverride: vi.fn(),
    warmupState: "idle",
    warmupVisible: false,
    onWarmup: vi.fn(),
    manualStopAndSend: vi.fn(),
    ignoreContinuousRecording: vi.fn(),
    scrollAreaRef: { current: null },
    micListening: false,
    micSpeaking: false,
    micStream: null,
    micBridge: null,
    pendingScreenshot: null,
    isStalled: false,
    aiStatusMessage: "",
    stallWait: vi.fn(),
    stallRetry: vi.fn(),
    stallNext: vi.fn(),
    stallNextId: undefined,
    setConversation: vi.fn(),
    processWithAI: vi.fn(),
    isPopoverOpen: false,
    respondToMic: false,
    setRespondToMic: vi.fn(),
    activeProviderId: "openai",
    onSetSelectedAIProvider: mockOnSetSelectedAIProvider,
  };
}

describe("R01 & R04: Mode toolbar and model badge filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveProfileId = "profile-interview";
  });

  it("R01: filters toolbar buttons in interview profile (hides livecode and code buttons)", () => {
    mockActiveProfileId = "profile-interview";
    render(<SystemAudio {...createProps()} />);

    expect(screen.getByTestId("toggle-thought-mode")).toBeDefined();
    expect(screen.queryByTestId("toggle-livecode-mode")).toBeNull();
    expect(screen.queryByText("План")).toBeNull();
    expect(screen.queryByText("Код")).toBeNull();
    expect(screen.queryByTestId("monologue-send-btn")).toBeNull();
  });

  it("R01: renders livecode and code mode buttons when in livecode profile", () => {
    mockActiveProfileId = "profile-livecode";
    render(<SystemAudio {...createProps()} />);

    expect(screen.getByTestId("toggle-thought-mode")).toBeDefined();
    expect(screen.getByTestId("toggle-livecode-mode")).toBeDefined();
    expect(screen.getByText("План")).toBeDefined();
    expect(screen.getByText("Код")).toBeDefined();
    expect(screen.getByText("Код со скрина")).toBeDefined();
  });

  it("R01: renders monologue button in general profile", () => {
    mockActiveProfileId = "profile-general";
    render(<SystemAudio {...createProps()} />);

    expect(screen.getByTestId("monologue-send-btn")).toBeDefined();
  });

  it("R04: displays model badge with activeProviderId and model", () => {
    render(<SystemAudio {...createProps()} />);

    const badge = screen.getByTestId("model-badge-trigger");
    expect(badge).toBeDefined();
    expect(badge.textContent).toContain("openai");
  });

  it("R04: quick-switches provider and updates selection on click", async () => {
    const user = userEvent.setup();
    render(<SystemAudio {...createProps()} />);

    const badge = screen.getByTestId("model-badge-trigger");
    await user.click(badge);

    const anthropicOption = await screen.findByTestId("provider-option-anthropic");
    await user.click(anthropicOption);

    expect(mockOnSetSelectedAIProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic" })
    );
  });

  it("R04: cross-window sync updates badge via storage event", () => {
    render(<SystemAudio {...createProps()} />);

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "curl_selected_ai_provider",
          newValue: JSON.stringify({ provider: "anthropic", variables: {} }),
        })
      );
    });

    const badge = screen.getByTestId("model-badge-trigger");
    expect(badge.textContent).toContain("anthropic");
  });
});
