import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useQuestionPipeline } from "../useQuestionPipeline";
import type { LiveSegment } from "../useConversationStore";
import { selectFillerForText } from "@/lib/transcript-stabilizer";

vi.mock("@/lib/transcript-stabilizer", () => ({
  selectFillerForText: vi.fn(() => "Да, секундочку..."),
}));

describe("useQuestionPipeline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("initializes with default state", () => {
    const onTriggerAI = vi.fn().mockResolvedValue(undefined);
    const liveSegmentsRef = { current: [] as LiveSegment[] };

    const { result } = renderHook(() =>
      useQuestionPipeline({ onTriggerAI, liveSegmentsRef })
    );

    expect(result.current.activeFiller).toBeNull();
    expect(result.current.pendingUtteranceId).toBeNull();
    expect(result.current.activeAskUtteranceIdRef.current).toBeNull();
    expect(result.current.questionAssemblerRef.current).toBeDefined();
  });

  it("manages filler lifecycle and utterance anchoring", () => {
    const onTriggerAI = vi.fn().mockResolvedValue(undefined);
    const liveSegmentsRef = {
      current: [
        { id: "seg-1", source: "me" as const, text: "Hello", timestamp: 100 },
        { id: "seg-2", source: "them" as const, text: "Question part 1", timestamp: 200 },
      ],
    };

    const { result } = renderHook(() =>
      useQuestionPipeline({ onTriggerAI, liveSegmentsRef })
    );

    act(() => {
      result.current.setFillerForInterviewer();
    });

    expect(result.current.activeFiller).toBe("Да, секундочку...");
    expect(result.current.pendingUtteranceId).toBe("seg-2");
    expect(result.current.activeAskUtteranceIdRef.current).toBe("seg-2");

    act(() => {
      result.current.clearFiller();
    });

    expect(result.current.activeFiller).toBeNull();
    expect(result.current.pendingUtteranceId).toBeNull();
    expect(result.current.activeAskUtteranceIdRef.current).toBeNull();
  });

  it("immediately emits when transcription contains a question mark", async () => {
    const onTriggerAI = vi.fn().mockResolvedValue(undefined);
    const liveSegmentsRef = { current: [] as LiveSegment[] };

    const { result } = renderHook(() =>
      useQuestionPipeline({ onTriggerAI, liveSegmentsRef })
    );

    await act(async () => {
      await result.current.handleInterviewerTranscription("Как работает Garbage Collector в Java?");
    });

    expect(onTriggerAI).toHaveBeenCalledTimes(1);
    expect(onTriggerAI).toHaveBeenCalledWith("Как работает Garbage Collector в Java?", "them");
  });

  it("accumulates fragmented input and flushes after silence gap timer", async () => {
    const onTriggerAI = vi.fn().mockResolvedValue(undefined);
    const liveSegmentsRef = { current: [] as LiveSegment[] };

    const { result } = renderHook(() =>
      useQuestionPipeline({ onTriggerAI, liveSegmentsRef })
    );

    await act(async () => {
      await result.current.handleInterviewerTranscription("Расскажите про свой опыт");
    });

    expect(onTriggerAI).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.handleInterviewerTranscription("с микросервисной архитектурой");
    });

    expect(onTriggerAI).not.toHaveBeenCalled();

    // Fast-forward past flushGapMs (accurate preset flushGapMs = 1500)
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });

    expect(onTriggerAI).toHaveBeenCalledTimes(1);
    expect(onTriggerAI).toHaveBeenCalledWith(
      "Расскажите про свой опыт с микросервисной архитектурой",
      "them"
    );
  });

  it("deduplicates identical fragments arriving in short succession", async () => {
    const onTriggerAI = vi.fn().mockResolvedValue(undefined);
    const liveSegmentsRef = { current: [] as LiveSegment[] };

    const { result } = renderHook(() =>
      useQuestionPipeline({ onTriggerAI, liveSegmentsRef })
    );

    await act(async () => {
      await result.current.handleInterviewerTranscription("Расскажите про микросервисы");
    });

    // Duplicate segment from STT
    await act(async () => {
      await result.current.handleInterviewerTranscription("Расскажите про микросервисы");
    });

    await act(async () => {
      vi.advanceTimersByTime(1600);
    });

    expect(onTriggerAI).toHaveBeenCalledTimes(1);
    expect(onTriggerAI).toHaveBeenCalledWith(
      "Расскажите про микросервисы",
      "them"
    );
  });

  it("resets question assembler and cancels pending flush timer", async () => {
    const onTriggerAI = vi.fn().mockResolvedValue(undefined);
    const liveSegmentsRef = { current: [] as LiveSegment[] };

    const { result } = renderHook(() =>
      useQuestionPipeline({ onTriggerAI, liveSegmentsRef })
    );

    await act(async () => {
      await result.current.handleInterviewerTranscription("Незаконченный вопрос");
    });

    act(() => {
      result.current.resetQuestionAssembly();
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onTriggerAI).not.toHaveBeenCalled();
  });

  it("displays filler immediately on dispatch without anchorId (null anchor)", () => {
    const onTriggerAI = vi.fn().mockResolvedValue(undefined);
    const liveSegmentsRef = { current: [] as LiveSegment[] };

    const { result } = renderHook(() =>
      useQuestionPipeline({ onTriggerAI, liveSegmentsRef })
    );

    act(() => {
      result.current.setFillerForInterviewer();
    });

    // Even with 0 segments (anchorId null), activeFiller MUST be displayed immediately
    expect(result.current.activeFiller).toBe("Да, секундочку...");
    expect(result.current.pendingUtteranceId).toBeNull();
    expect(result.current.activeAskUtteranceIdRef.current).toBe("auto");
  });

  it("keeps ONE stable filler per answer and clears on clearFiller (no rotation)", () => {
    let fillerCount = 0;
    const mockSelect = vi.fn(() => `Перебивка ${++fillerCount}`);
    vi.mocked(selectFillerForText).mockImplementation(mockSelect);
    const onTriggerAI = vi.fn().mockResolvedValue(undefined);
    const liveSegmentsRef = { current: [] as LiveSegment[] };

    const { result } = renderHook(() =>
      useQuestionPipeline({ onTriggerAI, liveSegmentsRef })
    );

    act(() => {
      result.current.setFillerForAnchor(null);
    });

    expect(result.current.activeFiller).toBe("Перебивка 1");

    // Phrase must remain stable while waiting: the user reads it aloud
    // mid-sentence, mid-air rotation is confusing (one filler per answer).
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(result.current.activeFiller).toBe("Перебивка 1");
    expect(mockSelect).toHaveBeenCalledTimes(1);

    // Calling clearFiller (simulating first token arrival or error/abort)
    act(() => {
      result.current.clearFiller();
    });
    expect(result.current.activeFiller).toBeNull();

    // A NEW answer picks a NEW phrase.
    act(() => {
      result.current.setFillerForAnchor(null);
    });
    expect(result.current.activeFiller).toBe("Перебивка 2");
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  it("calls selectFillerForText exactly once per answer (no rotation timers)", () => {
    const mockSelect = vi.fn(() => "Фраза");
    vi.mocked(selectFillerForText).mockImplementation(mockSelect);
    const onTriggerAI = vi.fn().mockResolvedValue(undefined);
    const liveSegmentsRef = { current: [] as LiveSegment[] };

    const { result, unmount } = renderHook(() =>
      useQuestionPipeline({
        onTriggerAI,
        liveSegmentsRef,
      })
    );

    act(() => {
      result.current.setFillerForInterviewer();
    });
    expect(mockSelect).toHaveBeenCalledTimes(1);

    unmount();

    // No rotation timers exist anymore: time passing must not pick again.
    act(() => {
      vi.advanceTimersByTime(12000);
    });
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });
});
