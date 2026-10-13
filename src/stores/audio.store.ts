import { create } from "zustand";
import { SPEECH_TO_TEXT_PROVIDERS, STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib";
import { TYPE_PROVIDER } from "@/types";
import curl2Json from "@bany/curl-to-json";

export interface SelectedAudioDevices {
  input: { id: string; name: string };
  output: { id: string; name: string };
}

export interface SelectedSttProvider {
  provider: string;
  variables: Record<string, string>;
}

export interface AudioState {
  selectedAudioDevices: SelectedAudioDevices;
  allSttProviders: TYPE_PROVIDER[];
  customSttProviders: TYPE_PROVIDER[];
  selectedSttProvider: SelectedSttProvider;

  setSelectedAudioDevices: (
    devices:
      | SelectedAudioDevices
      | ((prev: SelectedAudioDevices) => SelectedAudioDevices)
  ) => void;
  setSelectedSttProvider: (
    provider:
      | SelectedSttProvider
      | ((prev: SelectedSttProvider) => SelectedSttProvider)
  ) => void;
  onSetSelectedSttProvider: (selection: SelectedSttProvider) => void;
  setCustomSttProviders: (providers: TYPE_PROVIDER[]) => void;
  loadAudioData: () => void;
}

const parseCustomSttProviders = (providersJson: string): TYPE_PROVIDER[] => {
  try {
    const parsed = JSON.parse(providersJson);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((p) => {
        try {
          curl2Json(p.curl);
          return true;
        } catch {
          return false;
        }
      })
      .map((p) => {
        const provider = { ...p, isCustom: true };
        if (provider.curl) {
          provider.curl = provider.curl.replace(/AUDIO_BASE64/g, "AUDIO");
        }
        return provider;
      });
  } catch (e) {
    console.warn("Failed to parse custom STT providers", e);
    return [];
  }
};

const getInitialAudioDevices = (): SelectedAudioDevices => {
  const savedDevices = safeLocalStorage.getItem(
    STORAGE_KEYS.SELECTED_AUDIO_DEVICES
  );
  if (savedDevices) {
    try {
      const parsed = JSON.parse(savedDevices);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Default on parse error
    }
  }

  return {
    input: { id: "", name: "" },
    output: { id: "", name: "" },
  };
};

const getInitialSelectedStt = (): SelectedSttProvider => {
  const savedSelectedStt = safeLocalStorage.getItem(
    STORAGE_KEYS.SELECTED_STT_PROVIDER
  );
  if (savedSelectedStt) {
    try {
      return JSON.parse(savedSelectedStt);
    } catch {
      return {
        provider: "handy-local-whisper",
        variables: {},
      };
    }
  }
  return {
    provider: "handy-local-whisper",
    variables: {},
  };
};

const getInitialCustomStt = (): TYPE_PROVIDER[] => {
  const savedStt = safeLocalStorage.getItem(
    STORAGE_KEYS.CUSTOM_SPEECH_PROVIDERS
  );
  if (savedStt) {
    return parseCustomSttProviders(savedStt);
  }
  return [];
};

export const useAudioStore = create<AudioState>((set, get) => {
  const initialCustomStt = getInitialCustomStt();

  return {
    selectedAudioDevices: getInitialAudioDevices(),
    customSttProviders: initialCustomStt,
    allSttProviders: [...SPEECH_TO_TEXT_PROVIDERS, ...initialCustomStt],
    selectedSttProvider: getInitialSelectedStt(),

    setSelectedAudioDevices: (updater) => {
      const current = get().selectedAudioDevices;
      const next = typeof updater === "function" ? updater(current) : updater;
      safeLocalStorage.setItem(
        STORAGE_KEYS.SELECTED_AUDIO_DEVICES,
        JSON.stringify(next)
      );
      set({ selectedAudioDevices: next });
    },

    setSelectedSttProvider: (updater) => {
      const current = get().selectedSttProvider;
      const next = typeof updater === "function" ? updater(current) : updater;
      if (next.provider) {
        safeLocalStorage.setItem(
          STORAGE_KEYS.SELECTED_STT_PROVIDER,
          JSON.stringify(next)
        );
      }
      set({ selectedSttProvider: next });
    },

    onSetSelectedSttProvider: ({ provider, variables }) => {
      if (provider && !get().allSttProviders.some((p) => p.id === provider)) {
        console.warn(`Invalid STT provider ID: ${provider}`);
        return;
      }

      const next = { provider, variables };
      if (provider) {
        safeLocalStorage.setItem(
          STORAGE_KEYS.SELECTED_STT_PROVIDER,
          JSON.stringify(next)
        );
      }
      set({ selectedSttProvider: next });
    },

    setCustomSttProviders: (providers: TYPE_PROVIDER[]) => {
      set({
        customSttProviders: providers,
        allSttProviders: [...SPEECH_TO_TEXT_PROVIDERS, ...providers],
      });
    },

    loadAudioData: () => {
      // Custom STT
      const savedStt = safeLocalStorage.getItem(
        STORAGE_KEYS.CUSTOM_SPEECH_PROVIDERS
      );
      let sttList: TYPE_PROVIDER[] = [];
      if (savedStt) {
        sttList = parseCustomSttProviders(savedStt);
      }

      // Selected STT
      let selectedStt = get().selectedSttProvider;
      const savedSelectedStt = safeLocalStorage.getItem(
        STORAGE_KEYS.SELECTED_STT_PROVIDER
      );
      if (savedSelectedStt) {
        try {
          selectedStt = JSON.parse(savedSelectedStt);
        } catch {
          selectedStt = {
            provider: "handy-local-whisper",
            variables: {},
          };
          safeLocalStorage.setItem(
            STORAGE_KEYS.SELECTED_STT_PROVIDER,
            JSON.stringify(selectedStt)
          );
        }
      } else {
        selectedStt = {
          provider: "handy-local-whisper",
          variables: {},
        };
        safeLocalStorage.setItem(
          STORAGE_KEYS.SELECTED_STT_PROVIDER,
          JSON.stringify(selectedStt)
        );
      }

      // Audio devices
      let audioDevs = get().selectedAudioDevices;
      const savedAudioDevices = safeLocalStorage.getItem(
        STORAGE_KEYS.SELECTED_AUDIO_DEVICES
      );
      if (savedAudioDevices) {
        try {
          const parsed = JSON.parse(savedAudioDevices);
          if (parsed && typeof parsed === "object") {
            audioDevs = parsed;
          }
        } catch {
          console.warn("Failed to parse selected audio devices");
        }
      }

      set({
        customSttProviders: sttList,
        allSttProviders: [...SPEECH_TO_TEXT_PROVIDERS, ...sttList],
        selectedSttProvider: selectedStt,
        selectedAudioDevices: audioDevs,
      });
    },
  };
});
