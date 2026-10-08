import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useQuestionPipeline, TURN_GATE_STATUS_EVENT } from "../useQuestionPipeline";
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

  it("cancels pending gap timer on unmount", async () => {
    const onTriggerAI = vi.fn().mockResolvedValue(undefined);
    const liveSegmentsRef = { current: [] as LiveSegment[] };

    const { result, unmount } = renderHook(() =>
      useQuestionPipeline({ onTriggerAI, liveSegmentsRef })
    );

    // Push an incomplete fragment so it arms the gap timer
    await act(async () => {
      await result.current.handleInterviewerTranscription("Расскажи о");
    });

    expect(onTriggerAI).not.toHaveBeenCalled();

    // Unmount before gap timer expires
    unmount();

    // Advance time past the gap timer threshold
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // onTriggerAI must NOT have been called because timer was cancelled on unmount
    expect(onTriggerAI).not.toHaveBeenCalled();
  });

  describe("R01/R02: Profile reconfig & Monologue dispatch modes", () => {
    it("reconfigures assembler timings and cancels pending timers on profile switch", async () => {
      const onTriggerAI = vi.fn().mockResolvedValue(undefined);
      const liveSegmentsRef = { current: [] as LiveSegment[] };

      const { result } = renderHook(() =>
        useQuestionPipeline({ onTriggerAI, liveSegmentsRef })
      );

      // Speak in current profile -> arms timer
      await act(async () => {
        await result.current.handleInterviewerTranscription("Фрагмент в первом профиле");
      });

      // Switch to a new profile with different timings
      act(() => {
        result.current.reconfigureProfile({
          id: "custom-profile",
          name: "Custom",
          description: "",
          systemPrompt: "custom prompt",
          humanizerEnabled: true,
          interviewMode: false,
          customStyle: "",
          ragResumeEnabled: false,
          ragJobEnabled: false,
          flushGapMs: 2500,
          monologue: { mode: "auto", maxWindow: 20000 },
        });
      });

      // Advance old timer time: the old timer should have been cancelled, so no dispatch
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(onTriggerAI).not.toHaveBeenCalled();

      // Push fragment in new profile: requires 2500ms
      await act(async () => {
        await result.current.handleInterviewerTranscription("Новый фрагмент");
      });

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(onTriggerAI).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      expect(onTriggerAI).toHaveBeenCalledTimes(1);
      expect(onTriggerAI).toHaveBeenCalledWith("Новый фрагмент", "them");
    });

    it("monologue mode 'auto' sends whole chunk of non-stop speech as ONE prompt", async () => {
      const onTriggerAI = vi.fn().mockResolvedValue(undefined);
      const liveSegmentsRef = { current: [] as LiveSegment[] };

      const conversationProfile = {
        id: "profile-general",
        name: "General",
        description: "",
        systemPrompt: "chat prompt",
        humanizerEnabled: true,
        interviewMode: false,
        customStyle: "",
        ragResumeEnabled: false,
        ragJobEnabled: false,
        flushGapMs: 1500,
        monologue: { mode: "auto" as const, maxWindow: 15000 },
      };

      const { result } = renderHook(() =>
        useQuestionPipeline({
          onTriggerAI,
          liveSegmentsRef,
          profile: conversationProfile,
        })
      );

      // Continuous non-stop speech arriving in segments
      await act(async () => {
        await result.current.handleInterviewerTranscription("Слушай, у нас возникла проблема с нагрузкой на сервере,");
      });

      await act(async () => {
        await result.current.handleInterviewerTranscription("база данных перестала отвечать на запросы пользователей,");
      });

      await act(async () => {
        await result.current.handleInterviewerTranscription("и нам нужно срочно настроить репликацию и шардирование.");
      });

      expect(onTriggerAI).not.toHaveBeenCalled();

      // Silence gap elapses (1500ms)
      await act(async () => {
        vi.advanceTimersByTime(1600);
      });

      // Emitted once as ONE single prompt, containing the whole chunk!
      expect(onTriggerAI).toHaveBeenCalledTimes(1);
      expect(onTriggerAI).toHaveBeenCalledWith(
        "Слушай, у нас возникла проблема с нагрузкой на сервере, база данных перестала отвечать на запросы пользователей, и нам нужно срочно настроить репликацию и шардирование.",
        "them"
      );
    });

    it("monologue mode 'semi' waits for confirmation and sends whole chunk on confirmMonologue", async () => {
      const onTriggerAI = vi.fn().mockResolvedValue(undefined);
      const liveSegmentsRef = { current: [] as LiveSegment[] };

      const semiProfile = {
        id: "profile-semi",
        name: "Semi-Auto",
        description: "",
        systemPrompt: "prompt",
        humanizerEnabled: true,
        interviewMode: false,
        customStyle: "",
        ragResumeEnabled: false,
        ragJobEnabled: false,
        flushGapMs: 1000,
        monologue: { mode: "semi" as const, maxWindow: 15000 },
      };

      const { result } = renderHook(() =>
        useQuestionPipeline({
          onTriggerAI,
          liveSegmentsRef,
          profile: semiProfile,
        })
      );

      await act(async () => {
        await result.current.handleInterviewerTranscription("Первая фраза полуавтомата,");
      });
      await act(async () => {
        await result.current.handleInterviewerTranscription("вторая фраза полуавтомата.");
      });

      // Silence gap fires
      await act(async () => {
        vi.advanceTimersByTime(1100);
      });

      // Must NOT auto-dispatch to AI!
      expect(onTriggerAI).not.toHaveBeenCalled();
      expect(result.current.isMonologueReady).toBe(true);

      // User confirms
      await act(async () => {
        await result.current.confirmMonologue();
      });

      expect(onTriggerAI).toHaveBeenCalledTimes(1);
      expect(onTriggerAI).toHaveBeenCalledWith(
        "Первая фраза полуавтомата, вторая фраза полуавтомата.",
        "them"
      );
      expect(result.current.isMonologueReady).toBe(false);
    });

    it("monologue mode 'manual' only sends when flushMonologue is triggered", async () => {
      const onTriggerAI = vi.fn().mockResolvedValue(undefined);
      const liveSegmentsRef = { current: [] as LiveSegment[] };

      const manualProfile = {
        id: "profile-manual",
        name: "Manual",
        description: "",
        systemPrompt: "prompt",
        humanizerEnabled: true,
        interviewMode: false,
        customStyle: "",
        ragResumeEnabled: false,
        ragJobEnabled: false,
        flushGapMs: 1000,
        monologue: { mode: "manual" as const, maxWindow: 20000 },
      };

      const { result } = renderHook(() =>
        useQuestionPipeline({
          onTriggerAI,
          liveSegmentsRef,
          profile: manualProfile,
        })
      );

      await act(async () => {
        await result.current.handleInterviewerTranscription("Ручной фрагмент 1.");
      });

      // Even long silence does not trigger dispatch
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(onTriggerAI).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.handleInterviewerTranscription("Ручной фрагмент 2.");
      });

      // User clicks manual send button
      await act(async () => {
        await result.current.flushMonologue();
      });

      expect(onTriggerAI).toHaveBeenCalledTimes(1);
      expect(onTriggerAI).toHaveBeenCalledWith(
        "Ручной фрагмент 1. Ручной фрагмент 2.",
        "them"
      );
    });

    it("R06 turn-gate: answerAnyway dispatches pending utterance bypassing gap timer", async () => {
      const onTriggerAI = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useQuestionPipeline({ onTriggerAI, liveSegmentsRef: { current: [] } })
      );

      await act(async () => {
        await result.current.handleInterviewerTranscription("Ну в общем мы используем");
      });
      expect(result.current.turnGateWaiting).toBe(true);
      expect(onTriggerAI).not.toHaveBeenCalled();

      let sent: string | null = null;
      await act(async () => {
        sent = await result.current.answerAnyway();
      });
      expect(sent).toContain("используем");
      expect(onTriggerAI).toHaveBeenCalledTimes(1);
      expect(result.current.turnGateWaiting).toBe(false);
    });

    describe("R04: Turn-gate status reset on all dispatch paths", () => {
      it("resets turn-gate on monologue-fallback dispatch (R04)", async () => {
        const onTriggerAI = vi.fn().mockResolvedValue(undefined);
        const statusEvents: boolean[] = [];
        const onStatus = (e: Event) => statusEvents.push(Boolean((e as CustomEvent).detail));
        window.addEventListener(TURN_GATE_STATUS_EVENT, onStatus);

        const { result } = renderHook(() =>
          useQuestionPipeline({
            onTriggerAI,
            liveSegmentsRef: { current: [] },
            profile: {
              id: "profile-auto",
              name: "Auto",
              description: "",
              systemPrompt: "prompt",
              humanizerEnabled: true,
              interviewMode: false,
              customStyle: "",
              ragResumeEnabled: false,
              ragJobEnabled: false,
              flushGapMs: 1000,
              monologue: { mode: "auto", maxWindow: 20000 },
            },
          })
        );

        await act(async () => {
          await result.current.handleInterviewerTranscription("Рассказ без вопросительного знака");
        });
        expect(result.current.turnGateWaiting).toBe(true);
        expect(statusEvents).toContain(true);

        // Fast-forward silence gap to trigger monologue fallback flush
        await act(async () => {
          vi.advanceTimersByTime(1100);
        });

        expect(onTriggerAI).toHaveBeenCalledTimes(1);
        expect(result.current.turnGateWaiting).toBe(false);
        expect(statusEvents[statusEvents.length - 1]).toBe(false);
        window.removeEventListener(TURN_GATE_STATUS_EVENT, onStatus);
      });

      it("resets turn-gate on semi mode silence gap and confirmation (R04)", async () => {
        const onTriggerAI = vi.fn().mockResolvedValue(undefined);
        const statusEvents: boolean[] = [];
        const onStatus = (e: Event) => statusEvents.push(Boolean((e as CustomEvent).detail));
        window.addEventListener(TURN_GATE_STATUS_EVENT, onStatus);

        const { result } = renderHook(() =>
          useQuestionPipeline({
            onTriggerAI,
            liveSegmentsRef: { current: [] },
            profile: {
              id: "profile-semi",
              name: "Semi",
              description: "",
              systemPrompt: "prompt",
              humanizerEnabled: true,
              interviewMode: false,
              customStyle: "",
              ragResumeEnabled: false,
              ragJobEnabled: false,
              flushGapMs: 800,
              monologue: { mode: "semi", maxWindow: 20000 },
            },
          })
        );

        await act(async () => {
          await result.current.handleInterviewerTranscription("Полуавтоматический ввод");
        });
        expect(result.current.turnGateWaiting).toBe(true);

        // Silence gap fires -> ready for confirmation, gate must clear
        await act(async () => {
          vi.advanceTimersByTime(900);
        });
        expect(result.current.isMonologueReady).toBe(true);
        expect(result.current.turnGateWaiting).toBe(false);
        expect(statusEvents[statusEvents.length - 1]).toBe(false);

        // User confirms monologue -> gate remains false
        await act(async () => {
          await result.current.confirmMonologue();
        });
        expect(result.current.turnGateWaiting).toBe(false);
        window.removeEventListener(TURN_GATE_STATUS_EVENT, onStatus);
      });

      it("resets turn-gate on manual mode silence gap and manual flush (R04)", async () => {
        const onTriggerAI = vi.fn().mockResolvedValue(undefined);
        const statusEvents: boolean[] = [];
        const onStatus = (e: Event) => statusEvents.push(Boolean((e as CustomEvent).detail));
        window.addEventListener(TURN_GATE_STATUS_EVENT, onStatus);

        const { result } = renderHook(() =>
          useQuestionPipeline({
            onTriggerAI,
            liveSegmentsRef: { current: [] },
            profile: {
              id: "profile-manual",
              name: "Manual",
              description: "",
              systemPrompt: "prompt",
              humanizerEnabled: true,
              interviewMode: false,
              customStyle: "",
              ragResumeEnabled: false,
              ragJobEnabled: false,
              flushGapMs: 800,
              monologue: { mode: "manual", maxWindow: 20000 },
            },
          })
        );

        await act(async () => {
          await result.current.handleInterviewerTranscription("Ручной режим монолога");
        });
        expect(result.current.turnGateWaiting).toBe(true);

        // Gap fires -> gate must clear
        await act(async () => {
          vi.advanceTimersByTime(900);
        });
        expect(result.current.turnGateWaiting).toBe(false);
        expect(statusEvents[statusEvents.length - 1]).toBe(false);

        // User flushes manually
        await act(async () => {
          await result.current.flushMonologue();
        });
        expect(result.current.turnGateWaiting).toBe(false);
        window.removeEventListener(TURN_GATE_STATUS_EVENT, onStatus);
      });

      it("resets turn-gate when resetQuestionAssembly is called (R04)", async () => {
        const onTriggerAI = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() =>
          useQuestionPipeline({ onTriggerAI, liveSegmentsRef: { current: [] } })
        );

        await act(async () => {
          await result.current.handleInterviewerTranscription("Фраза до сброса");
        });
        expect(result.current.turnGateWaiting).toBe(true);

        act(() => {
          result.current.resetQuestionAssembly();
        });
        expect(result.current.turnGateWaiting).toBe(false);
      });
    });
  });
});
