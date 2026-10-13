import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { resetAllStores } from "../stores/reset";

// Radix UI (Slider и др.) требует ResizeObserver, которого нет в jsdom.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

beforeEach(() => {
  resetAllStores();
});
