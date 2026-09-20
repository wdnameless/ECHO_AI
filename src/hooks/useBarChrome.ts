import { useEffect } from "react";

/** Gap between the top bar and the docked panel below it. */
const PANEL_GAP = 6;

/**
 * Publishes the top bar's height as `--bar-chrome`.
 *
 * The bar's height is not a constant: the font-size setting scales its text, and
 * the mode switcher changes the row's content. Everything that docks under the
 * bar (the meeting panel, the long-form popovers) is positioned from this
 * variable, so measuring it beats hardcoding a value that drifts as soon as the
 * user picks a different font size.
 */
export const useBarChrome = () => {
  useEffect(() => {
    const root = document.documentElement;

    const measure = () => {
      const bar = document.querySelector<HTMLElement>("[data-slot='card']");
      if (!bar) return;
      const bottom = bar.getBoundingClientRect().bottom;
      if (bottom <= 0) return;
      root.style.setProperty("--bar-chrome", `${Math.round(bottom + PANEL_GAP)}px`);
    };

    measure();

    // The bar resizes with the font-size setting and with its own content, so
    // watch it rather than re-measuring on a timer.
    const observer = new ResizeObserver(measure);
    const bar = document.querySelector<HTMLElement>("[data-slot='card']");
    if (bar) observer.observe(bar);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
};
