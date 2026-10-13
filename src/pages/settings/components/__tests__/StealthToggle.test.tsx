import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { StealthToggle } from "../StealthToggle";

const mockToggleStealthMode = vi.fn();
let mockCustomizable = {
  stealth: { isEnabled: false },
};

type MockStealthState = {
  customizable: typeof mockCustomizable;
  toggleStealthMode: typeof mockToggleStealthMode;
};

vi.mock("@/stores", () => ({
  useStealthStore: <T,>(selector: (state: MockStealthState) => T) => {
    const state: MockStealthState = {
      customizable: mockCustomizable,
      toggleStealthMode: mockToggleStealthMode,
    };
    return selector(state);
  },
}));

describe("StealthToggle component (R09-R11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCustomizable = {
      stealth: { isEnabled: false },
    };
  });

  it("renders with title and unchecked switch when disabled", () => {
    render(
      <MemoryRouter>
        <StealthToggle />
      </MemoryRouter>
    );

    expect(screen.getByText(/Stealth Mode/i)).toBeInTheDocument();
    const switchElement = screen.getByRole("switch");
    expect(switchElement).not.toBeChecked();
  });

  it("renders checked switch when enabled", () => {
    mockCustomizable = {
      stealth: { isEnabled: true },
    };
    render(
      <MemoryRouter>
        <StealthToggle />
      </MemoryRouter>
    );

    const switchElement = screen.getByRole("switch");
    expect(switchElement).toBeChecked();
  });

  it("calls toggleStealthMode when switch is clicked", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <StealthToggle />
      </MemoryRouter>
    );

    const switchElement = screen.getByRole("switch");
    await user.click(switchElement);

    expect(mockToggleStealthMode).toHaveBeenCalledWith(true);
  });
});
