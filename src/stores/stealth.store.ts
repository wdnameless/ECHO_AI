import { create } from "zustand";
import { registerStoreReset } from "./reset";
import { STORAGE_KEYS } from "@/config";
import { getPlatform, safeLocalStorage } from "@/lib";
import {
  getCustomizableState,
  setCustomizableState,
  updateAppIconVisibility,
  updateAlwaysOnTop,
  updateAutostart,
  updateStealthMode,
  CustomizableState,
  CursorType,
  updateCursorType,
} from "@/lib/storage";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable, disable } from "@tauri-apps/plugin-autostart";

export interface StealthState {
  customizable: CustomizableState;

  setCustomizable: (
    updater:
      | CustomizableState
      | ((prev: CustomizableState) => CustomizableState)
  ) => void;
  toggleAppIconVisibility: (isVisible: boolean) => Promise<void>;
  toggleAlwaysOnTop: (isEnabled: boolean) => Promise<void>;
  toggleStealthMode: (isEnabled: boolean) => Promise<void>;
  toggleAutostart: (isEnabled: boolean) => Promise<void>;
  setCursorType: (type: CursorType) => void;
  updateCursor: (type: CursorType | undefined) => void;
  loadStealthData: () => void;
}

export const useStealthStore = create<StealthState>((set, get) => {
  const initialCustomizable = getCustomizableState();

  return {
    customizable: initialCustomizable,

    setCustomizable: (updater) => {
      const next =
        typeof updater === "function" ? updater(get().customizable) : updater;
      setCustomizableState(next);
      set({ customizable: next });
    },

    toggleAppIconVisibility: async (isVisible: boolean) => {
      const newState = updateAppIconVisibility(isVisible);
      set({ customizable: newState });
      try {
        await invoke("set_app_icon_visibility", { visible: isVisible });
      } catch (error) {
        console.error("Failed to toggle app icon visibility:", error);
      }
    },

    toggleAlwaysOnTop: async (isEnabled: boolean) => {
      const newState = updateAlwaysOnTop(isEnabled);
      set({ customizable: newState });
      try {
        await invoke("set_always_on_top", { enabled: isEnabled });
      } catch (error) {
        console.error("Failed to toggle always on top:", error);
      }
    },

    toggleStealthMode: async (isEnabled: boolean) => {
      const newState = updateStealthMode(isEnabled);
      set({ customizable: newState });
      try {
        await invoke("set_stealth_mode", { enabled: isEnabled });
      } catch (error) {
        console.error("Failed to toggle stealth mode:", error);
      }
    },

    toggleAutostart: async (isEnabled: boolean) => {
      const newState = updateAutostart(isEnabled);
      set({ customizable: newState });
      try {
        if (isEnabled) {
          await enable();
        } else {
          await disable();
        }
      } catch (error) {
        console.error("Failed to toggle autostart:", error);
        const revertedState = updateAutostart(!isEnabled);
        set({ customizable: revertedState });
      }
    },

    setCursorType: (type: CursorType) => {
      set((prev) => ({
        customizable: { ...prev.customizable, cursor: { type } },
      }));
      get().updateCursor(type);
      updateCursorType(type);
    },

    updateCursor: (type: CursorType | undefined) => {
      try {
        const currentWindow = getCurrentWindow();
        const platform = getPlatform();
        if (platform === "linux" || currentWindow.label === "dashboard") {
          document.documentElement.style.setProperty("--cursor-type", "default");
          return;
        }

        const safeType = type || "invisible";
        const cursorValue = type === "invisible" ? "none" : safeType;
        document.documentElement.style.setProperty("--cursor-type", cursorValue);
      } catch {
        document.documentElement.style.setProperty("--cursor-type", "default");
      }
    },

    loadStealthData: () => {
      const customizableState = getCustomizableState();
      set({ customizable: customizableState });
      get().updateCursor(customizableState.cursor.type || "invisible");

      if (customizableState.stealth) {
        invoke("set_stealth_mode", {
          enabled: customizableState.stealth.isEnabled,
        }).catch((err) => {
          console.debug("Failed to apply initial stealth mode:", err);
        });
      }

      const stored = safeLocalStorage.getItem(STORAGE_KEYS.CUSTOMIZABLE);
      if (!stored) {
        setCustomizableState(customizableState);
      } else {
        try {
          const parsed = JSON.parse(stored);
          if (!parsed.autostart) {
            setCustomizableState(customizableState);
            get().updateCursor(customizableState.cursor.type || "invisible");
          }
        } catch (error) {
          console.debug("Failed to check customizable state schema:", error);
        }
      }
    },
  };
});

export const initialStealthState: StealthState = useStealthStore.getState();

export const resetStealthStore = () => {
  useStealthStore.setState(initialStealthState, true);
};

registerStoreReset(resetStealthStore);
