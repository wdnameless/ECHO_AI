import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * A portable copy is updated into the normal install location, not in place: the
 * new copy starts with a fresh data directory, so the settings and the downloaded
 * speech model from the portable folder do not move across and the app comes back
 * looking broken. Someone pressed that button without knowing it once; this pins
 * the warning that tells them, and the case where it must stay out of the way.
 */
const getPathsMock = vi.fn();

vi.mock("@/lib/storage/app-paths", () => ({
  getPaths: () => getPathsMock(),
}));

import { PortableUpdateNotice, useIsPortable } from "../PortableUpdateNotice";

const Probe = () => {
  const isPortable = useIsPortable();
  return (
    <div>
      <span data-testid="kind">{isPortable ? "portable" : "installed"}</span>
      {isPortable && <PortableUpdateNotice />}
    </div>
  );
};

beforeEach(() => {
  getPathsMock.mockReset();
});

describe("portable update warning", () => {
  it("warns a portable copy that the update installs elsewhere", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "portable", root: "D:/app" });

    render(<Probe />);

    expect(await screen.findByText(/портативном режиме/i)).toBeTruthy();
    // The consequence and the way to stay portable both have to be stated.
    expect(screen.getByText(/своей папкой данных/i)).toBeTruthy();
    expect(screen.getByText(/portable_x64\.zip/)).toBeTruthy();
  });

  it("stays silent for a normal install, where the update is in place", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "appdata", root: "C:/data" });

    render(<Probe />);

    expect(await screen.findByTestId("kind")).toHaveTextContent("installed");
    expect(screen.queryByText(/портативном режиме/i)).toBeNull();
  });

  it("treats an unreadable layout as a normal install instead of guessing", async () => {
    getPathsMock.mockRejectedValue(new Error("backend unavailable"));

    render(<Probe />);

    expect(await screen.findByTestId("kind")).toHaveTextContent("installed");
  });
});
