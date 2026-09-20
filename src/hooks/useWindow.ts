import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect } from "react";
import { safeLocalStorage } from "@/lib/storage/helper";

const PANEL_HEIGHT_KEY = "echo_panel_height";

/** Height the panel opens at when the user has never resized it. */
export const DEFAULT_PANEL_HEIGHT = 600;
/** Below this the panel shows nothing useful, so it is not a usable preference. */
export const MIN_PANEL_HEIGHT = 220;

/**
 * Records the height the user dragged the panel to.
 *
 * Without this the stretched height survived only until the next mode switch:
 * collapsing to the bar dropped it to 54px, and expanding again had nothing left
 * to restore, so it came back at the default — which reads as "the resize does not
 * stick".
 */
export const rememberPanelHeight = (height: number) => {
  const clamped = Math.round(Math.max(MIN_PANEL_HEIGHT, height));
  safeLocalStorage.setItem(PANEL_HEIGHT_KEY, String(clamped));
};

const preferredPanelHeight = (): number => {
  const stored = Number(safeLocalStorage.getItem(PANEL_HEIGHT_KEY));
  if (!Number.isFinite(stored) || stored < MIN_PANEL_HEIGHT) {
    return DEFAULT_PANEL_HEIGHT;
  }
  // Never ask for more than the display can show.
  return Math.min(stored, window.screen.availHeight);
};

// Helper function to check if any dismissible surface is open in the DOM. The
// docked copilot panel is not a Radix popover, but it must count: otherwise
// closing an unrelated popover would collapse the window out from under it.
const isAnyPopoverOpen = (): boolean => {
  return (
    document.querySelectorAll("[data-radix-popper-content-wrapper]").length > 0 ||
    document.querySelectorAll("[data-panel-docked]").length > 0
  );
};

export const useWindowResize = () => {
  const resizeWindow = useCallback(async (expanded: boolean) => {
    try {
      const window = getCurrentWebviewWindow();

      if (!expanded && isAnyPopoverOpen()) {
        return;
      }

      const newHeight = expanded ? preferredPanelHeight() : 54;

      await invoke("set_window_height", {
        window,
        height: newHeight,
      });
    } catch (error) {
      console.error("Failed to resize window:", error);
    }
  }, []);

  // Setup drag handling and popover monitoring
  useEffect(() => {
    let isDragging = false;
    let popoverWasOpen = false;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isDragRegion = target.closest('[data-tauri-drag-region="true"]');

      if (isDragRegion) {
        isDragging = true;
      }
    };

    const handleMouseUp = async () => {
      if (isDragging) {
        isDragging = false;

        setTimeout(() => {
          if (!isAnyPopoverOpen()) {
            resizeWindow(false);
          }
        }, 100);
      }
    };

    const observer = new MutationObserver(() => {
      const popoverOpen = isAnyPopoverOpen();
      // Only collapse the window when a popover transitions from open to
      // closed. New messages / streaming text must NOT trigger a resize.
      if (popoverWasOpen && !popoverOpen) {
        resizeWindow(false);
      }
      popoverWasOpen = popoverOpen;
    });

    // Only the popover wrappers matter, and Radix mounts them as direct children
    // of <body>. Observing the whole subtree with attributes made this fire on
    // every streaming subtitle mutation, so it is deliberately shallow.
    observer.observe(document.body, {
      childList: true,
      subtree: false,
    });

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
      observer.disconnect();
    };
  }, [resizeWindow]);

  return { resizeWindow };
};

interface UseWindowFocusOptions {
  onFocusLost?: () => void;
  onFocusGained?: () => void;
}

export const useWindowFocus = ({
  onFocusLost,
  onFocusGained,
}: UseWindowFocusOptions = {}) => {
  const handleFocusChange = useCallback(
    async (focused: boolean) => {
      if (focused && onFocusGained) {
        onFocusGained();
      } else if (!focused && onFocusLost) {
        onFocusLost();
      }
    },
    [onFocusLost, onFocusGained]
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupFocusListener = async () => {
      try {
        const window = getCurrentWebviewWindow();

        // Listen to focus change events
        unlisten = await window.onFocusChanged(({ payload: focused }) => {
          handleFocusChange(focused);
        });
      } catch (error) {
        console.error("Failed to setup focus listener:", error);
      }
    };

    setupFocusListener();

    // Cleanup
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleFocusChange]);
};
