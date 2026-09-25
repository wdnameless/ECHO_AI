import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * `Markdown` must keep the engine behind a lazy boundary.
 *
 * The bar and 73 other modules import the `@/components` barrel, which
 * re-exports this file. A static import of the renderer here pulled katex and
 * the streaming engine into the startup bundle; the split into `./renderer`
 * behind `React.lazy` is what keeps them out. If anyone re-inlines the import,
 * the first assertion below fails — the heavy module is evaluated as soon as
 * this file is loaded, before the component ever mounts.
 *
 * The second assertion covers the behavioural half: while the engine loads (or
 * if it ever fails), the answer is still readable as plain text rather than a
 * blank box.
 */
const { engineEvaluated } = vi.hoisted(() => ({ engineEvaluated: vi.fn() }));

vi.mock("../renderer", () => {
  engineEvaluated();
  return {
    default: ({ children }: { children: string }) => (
      <div data-testid="engine">{children}</div>
    ),
  };
});

import { Markdown } from "../index";

describe("Markdown lazy loading", () => {
  it("does not evaluate the engine module at import time", () => {
    expect(engineEvaluated).not.toHaveBeenCalled();
  });

  it("renders the answer as plain text before the engine arrives", async () => {
    render(<Markdown>{"**привет**"}</Markdown>);

    // Suspense fallback shows the raw text immediately.
    expect(screen.getByText("**привет**")).toBeInTheDocument();

    // Then the real renderer takes over.
    expect(await screen.findByTestId("engine")).toHaveTextContent("**привет**");
  });
});
