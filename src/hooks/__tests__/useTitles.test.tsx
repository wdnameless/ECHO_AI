import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTitles } from "../useTitles";

function Controls({ title }: { title: string }) {
  useTitles();
  return <>
    <button type="button" title={title}><svg aria-hidden="true" /></button>
    <button type="button" title={title} aria-label="Explicit action"><svg aria-hidden="true" /></button>
    <button type="button" title={title}>Visible action</button>
  </>;
}

afterEach(() => { vi.useRealTimers(); });

it("preserves icon names and updates generated names without replacing authored labels", async () => {
  vi.useFakeTimers();
  const { rerender, unmount } = render(<Controls title="Pin window" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByRole("button", { name: "Pin window" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Explicit action" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Visible action" })).toBeVisible();
  rerender(<Controls title="Unpin window" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole("button", { name: "Unpin window" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Explicit action" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Visible action" })).toBeVisible();
  unmount();
});
