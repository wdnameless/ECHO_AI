import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * A portable copy updates from the zip target in place (`.echo-ai/` preserved);
 * an installed copy uses the default MSI/NSIS target. The layout decides the
 * package, and these pin that routing plus the notice text matching reality.
 */
const getPathsMock = vi.fn();
const checkMock = vi.fn();

vi.mock("@/lib/storage/app-paths", () => ({
  getPaths: () => getPathsMock(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));

import {
  PortableUpdateNotice,
  useIsPortable,
  checkForUpdateForLayout,
  PORTABLE_UPDATE_TARGET,
} from "../PortableUpdateNotice";

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
  checkMock.mockReset();
});

describe("portable update routing", () => {
  it("a portable copy checks the zip target", async () => {
    checkMock.mockResolvedValue(null);
    await checkForUpdateForLayout(true);
    expect(checkMock).toHaveBeenCalledOnce();
    expect(checkMock.mock.calls[0][0]).toEqual({
      target: PORTABLE_UPDATE_TARGET,
    });
  });

  it("an installed copy checks the default target", async () => {
    checkMock.mockResolvedValue(null);
    await checkForUpdateForLayout(false);
    expect(checkMock).toHaveBeenCalledOnce();
    // No target override: updater resolves MSI/NSIS itself.
    expect(checkMock.mock.calls[0][0]).toBeUndefined();
  });

  it("the notice promises in-place data preservation, not a reinstall", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "portable", root: "D:/app" });

    render(<Probe />);

    expect(await screen.findByText(/портативном режиме/i)).toBeTruthy();
    expect(screen.getByText(/\.echo-ai/i)).toBeTruthy();
    // The old text described installing elsewhere — it must be gone.
    expect(screen.queryByText(/системный каталог/i)).toBeNull();
    expect(screen.queryByText(/portable_x64\.zip/i)).toBeNull();
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
