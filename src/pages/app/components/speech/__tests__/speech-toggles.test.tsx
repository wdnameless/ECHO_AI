import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SystemAudio } from "../index";
import { getAnswerMode, setAnswerMode } from "@/lib/answer-mode";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: class {},
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setAlwaysOnTop: vi.fn(),
    setSize: vi.fn(),
    innerSize: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
  }),
}));

vi.mock("@/contexts", () => ({
  useApp: () => ({
    hasActiveLicense: true,
    supportsImages: false,
    promptProfiles: [{ id: "default", name: "Default" }],
    activeProfileId: "default",
    selectPromptProfile: vi.fn(),
    selectedAIProvider: { provider: "mock", variables: {} },
    allAiProviders: [],
  }),
}));

vi.mock("@/lib/version", () => ({
  useAppVersion: () => "1.0.0",
}));

vi.mock("@/lib/entitlements", () => ({
  canUseFeature: () => true,
  isDevBuild: () => true,
}));

vi.mock("../ResultsSection", () => ({
  ResultsSection: () => <div data-testid="results-section">Results</div>,
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

type SystemAudioProps = React.ComponentProps<typeof SystemAudio>;

function createProps(): SystemAudioProps {
  return {
    isMicProcessing: false,
    isSystemProcessing: false,
    lastTranscription: "",
    liveSegments: [],
    respondToMic: false,
    setRespondToMic: vi.fn(),
    useSystemPrompt: true,
    setUseSystemPrompt: vi.fn(),
    askAIForTranscript: vi.fn(),
    activeFiller: null,
    pendingUtteranceId: null,
    capturing: true,
    error: "",
    clearError: vi.fn(),
    isProcessing: false,
    isAIProcessing: false,
    myLastTranscription: "",
    theirLastTranscription: "Some question?",
    lastAIResponse: "",
    conversation: {
      id: "conv-1",
      title: "Test",
      messages: [],
      createdAt: 1000,
      updatedAt: 1000,
    },
    setConversation: vi.fn(),
    processWithAI: vi.fn(),
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
    contextContent: "",
    setContextContent: vi.fn(),
    isContinuousMode: false,
    setIsContinuousMode: vi.fn(),
    isRecordingInContinuousMode: false,
    setupRequired: false,
    handleSetup: vi.fn(),
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    isPopoverOpen: false,
    setIsPopoverOpen: vi.fn(),
    updateVadConfiguration: vi.fn(),
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
  };
}

describe("R01 & R02: Speech toolbar answer-mode toggles", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setAnswerMode("interview");
  });

  it("renders mutually exclusive toggles with interview default", () => {
    render(<SystemAudio {...createProps()} />);

    const thoughtBtn = screen.getByTestId("toggle-thought-mode");
    const livecodeBtn = screen.getByTestId("toggle-livecode-mode");

    expect(thoughtBtn).toBeDefined();
    expect(livecodeBtn).toBeDefined();
    expect(thoughtBtn.getAttribute("aria-pressed")).toBe("false");
    expect(livecodeBtn.getAttribute("aria-pressed")).toBe("false");
    expect(getAnswerMode()).toBe("interview");
  });

  it("clicking thought toggle turns on thought mode and flips aria-pressed", () => {
    render(<SystemAudio {...createProps()} />);

    const thoughtBtn = screen.getByTestId("toggle-thought-mode");
    fireEvent.click(thoughtBtn);

    expect(getAnswerMode()).toBe("thought");
    expect(thoughtBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking thought toggle again turns it off back to interview mode", () => {
    render(<SystemAudio {...createProps()} />);

    const thoughtBtn = screen.getByTestId("toggle-thought-mode");
    fireEvent.click(thoughtBtn);
    expect(getAnswerMode()).toBe("thought");

    fireEvent.click(thoughtBtn);
    expect(getAnswerMode()).toBe("interview");
    expect(thoughtBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("enforces mutual exclusivity: activating livecode deactivates thought", () => {
    render(<SystemAudio {...createProps()} />);

    const thoughtBtn = screen.getByTestId("toggle-thought-mode");
    const livecodeBtn = screen.getByTestId("toggle-livecode-mode");

    // Activate thought
    fireEvent.click(thoughtBtn);
    expect(getAnswerMode()).toBe("thought");
    expect(thoughtBtn.getAttribute("aria-pressed")).toBe("true");
    expect(livecodeBtn.getAttribute("aria-pressed")).toBe("false");

    // Activate livecode -> switches mode, turns off thought
    fireEvent.click(livecodeBtn);
    expect(getAnswerMode()).toBe("livecode");
    expect(thoughtBtn.getAttribute("aria-pressed")).toBe("false");
    expect(livecodeBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("enforces mutual exclusivity: activating thought deactivates livecode", () => {
    render(<SystemAudio {...createProps()} />);

    const thoughtBtn = screen.getByTestId("toggle-thought-mode");
    const livecodeBtn = screen.getByTestId("toggle-livecode-mode");

    // Activate livecode
    fireEvent.click(livecodeBtn);
    expect(getAnswerMode()).toBe("livecode");
    expect(livecodeBtn.getAttribute("aria-pressed")).toBe("true");

    // Activate thought
    fireEvent.click(thoughtBtn);
    expect(getAnswerMode()).toBe("thought");
    expect(thoughtBtn.getAttribute("aria-pressed")).toBe("true");
    expect(livecodeBtn.getAttribute("aria-pressed")).toBe("false");
  });
});
