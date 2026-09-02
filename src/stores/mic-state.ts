import { useSyncExternalStore } from "react";

export type MicMode = "IDLE" | "DICTATION" | "ASSISTANT";

export interface MicState {
  mode: MicMode;
  previousMode: MicMode;
  isProcessing: boolean;
  updatedAt: number;
}

type Listener = (state: MicState) => void;
type TranscriptListener = (text: string) => void;


let state: MicState = {
  mode: "IDLE",
  previousMode: "IDLE",
  isProcessing: false,
  updatedAt: Date.now(),
};

const listeners = new Set<Listener>();
const transcriptListeners = new Set<TranscriptListener>();


function emit(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(state);
    } catch {
      /* isolate faulty listeners */
    }
  }
}

export const micStateStore = {
  getState(): MicState {
    return state;
  },

  getMode(): MicMode {
    return state.mode;
  },

  isIdle(): boolean {
    return state.mode === "IDLE";
  },

  isDictation(): boolean {
    return state.mode === "DICTATION";
  },

  isAssistant(): boolean {
    return state.mode === "ASSISTANT";
  },

  setMode(target: MicMode): void {
    if (state.mode === target) return;
    state = {
      ...state,
      previousMode: state.mode,
      mode: target,
      updatedAt: Date.now(),
    };
    emit();
  },

  toggleMode(target: "DICTATION" | "ASSISTANT"): MicMode {
    const next: MicMode = state.mode === target ? "IDLE" : target;
    this.setMode(next);
    return next;
  },

  setIsProcessing(isProcessing: boolean): void {
    if (state.isProcessing === isProcessing) return;
    state = {
      ...state,
      isProcessing,
      updatedAt: Date.now(),
    };
    emit();
  },
  emitTranscript(text: string): void {
    for (const listener of Array.from(transcriptListeners)) {
      try {
        listener(text);
      } catch {
        /* isolate subscriber failures */
      }
    }
  },

  onTranscript(listener: TranscriptListener): () => void {
    transcriptListeners.add(listener);
    return () => {
      transcriptListeners.delete(listener);
    };
  },

  reset(): void {
    state = {
      mode: "IDLE",
      previousMode: "IDLE",
      isProcessing: false,
      updatedAt: Date.now(),
    };
    emit();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    try {
      listener(state);
    } catch {
      /* isolate */
    }
    return () => {
      listeners.delete(listener);
    };
  },
};

/**
 * React hook to consume MicState with automatic re-renders
 */
export function useMicState(): MicState {
  return useSyncExternalStore(
    micStateStore.subscribe,
    micStateStore.getState,
    micStateStore.getState
  );
}
