import "@testing-library/jest-dom/vitest";

// Radix UI (Slider и др.) требует ResizeObserver, которого нет в jsdom.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
