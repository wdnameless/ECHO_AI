import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getPathsMock = vi.fn();
const checkMock = vi.fn();
const relaunchMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@/lib/storage/app-paths", () => ({
  getPaths: () => getPathsMock(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: () => relaunchMock(),
}));

class MockChannel<T = unknown> {
  onmessage?: (response: T) => void;
  constructor(onmessage?: (response: T) => void) {
    this.onmessage = onmessage;
  }
}

vi.mock("@tauri-apps/api/core", () => ({
  Channel: MockChannel,
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@/hooks", () => ({
  useWindowResize: () => ({
    resizeWindow: vi.fn(),
  }),
}));

vi.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

import {
  PortableUpdateNotice,
  useIsPortable,
  checkForUpdateForLayout,
  installUpdateForLayout,
  PORTABLE_UPDATE_TARGET,
} from "../PortableUpdateNotice";
import { Updater } from "../index";
import { UpdateSettings } from "@/pages/settings/components/UpdateSettings";
import type { Update, DownloadEvent } from "@tauri-apps/plugin-updater";
import type { ResolvedPaths } from "@/lib/storage/app-paths";

function createMockUpdate(overrides: Partial<Update> = {}): Update {
  return {
    version: "2.0.0",
    currentVersion: "1.0.0",
    body: "Test release notes",
    available: true,
    downloadAndInstall: vi.fn().mockImplementation(async (onEvent?: (e: DownloadEvent) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 1000 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 1000 } });
      onEvent?.({ event: "Finished" });
    }),
    ...overrides,
  } as unknown as Update;
}

const ProbeNotice = () => {
  const isPortable = useIsPortable();
  return (
    <div>
      <span data-testid="kind">{isPortable ? "portable" : "installed"}</span>
      {isPortable && <PortableUpdateNotice />}
    </div>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkForUpdateForLayout", () => {
  it("delays check until getPaths resolves and never selects MSI/NSIS for portable", async () => {
    const { promise: pathsPromise, resolve: resolvePaths } = Promise.withResolvers<ResolvedPaths>();
    getPathsMock.mockReturnValue(pathsPromise);
    checkMock.mockResolvedValue(null);

    const checkPromise = checkForUpdateForLayout();

    // Check must not be issued before layout is known
    expect(checkMock).not.toHaveBeenCalled();

    resolvePaths({
      root_kind: "portable",
      root: "D:/app",
      engine_dir: "D:/app/engine",
      models_dir: "D:/app/models",
      logs_dir: "D:/app/logs",
      settings_path: "D:/app/settings.json",
      secrets_path: "D:/app/secrets.json",
      writable: true,
    });
    await checkPromise;

    expect(checkMock).toHaveBeenCalledOnce();
    expect(checkMock).toHaveBeenCalledWith({ target: PORTABLE_UPDATE_TARGET });
  });

  it("selects default updater target for appdata installed layout", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "appdata", root: "C:/data" });
    checkMock.mockResolvedValue(null);

    await checkForUpdateForLayout();

    expect(checkMock).toHaveBeenCalledOnce();
    expect(checkMock.mock.calls[0][0]).toBeUndefined();
  });

  it("rejects unknown storage layout without defaulting to installer", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "custom", root: "D:/custom" });

    await expect(checkForUpdateForLayout()).rejects.toThrow(/Unknown storage layout: custom/);
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("propagates layout retrieval failure without falling back to installer", async () => {
    getPathsMock.mockRejectedValue(new Error("native storage error"));

    await expect(checkForUpdateForLayout()).rejects.toThrow("native storage error");
    expect(checkMock).not.toHaveBeenCalled();
  });
});

describe("installUpdateForLayout", () => {
  it("portable layout invokes native install_portable_update, forwards progress, and returns false", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "portable", root: "D:/portable" });
    invokeMock.mockResolvedValue(undefined);

    const mockUpdate = createMockUpdate({ version: "2.1.0" });
    const events: DownloadEvent[] = [];
    const onEvent = (e: DownloadEvent) => events.push(e);

    const shouldRelaunch = await installUpdateForLayout(mockUpdate, onEvent);

    expect(shouldRelaunch).toBe(false);
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("install_portable_update", {
      expectedVersion: "2.1.0",
      onEvent: expect.any(MockChannel),
    });
    // Never calls stock downloadAndInstall for portable
    expect(mockUpdate.downloadAndInstall).not.toHaveBeenCalled();

    // Verify progress forwarding through Channel
    const channelPassed = invokeMock.mock.calls[0][1].onEvent as MockChannel<DownloadEvent>;
    channelPassed.onmessage?.({ event: "Started", data: { contentLength: 5000 } });
    channelPassed.onmessage?.({ event: "Progress", data: { chunkLength: 2500 } });
    channelPassed.onmessage?.({ event: "Finished" });

    expect(events).toEqual([
      { event: "Started", data: { contentLength: 5000 } },
      { event: "Progress", data: { chunkLength: 2500 } },
      { event: "Finished" },
    ]);
  });

  it("installed layout calls update.downloadAndInstall and returns true", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "appdata", root: "C:/Users/app" });

    const mockUpdate = createMockUpdate({ version: "2.1.0" });
    const events: DownloadEvent[] = [];
    const onEvent = (e: DownloadEvent) => events.push(e);

    const shouldRelaunch = await installUpdateForLayout(mockUpdate, onEvent);

    expect(shouldRelaunch).toBe(true);
    expect(mockUpdate.downloadAndInstall).toHaveBeenCalledOnce();
    expect(mockUpdate.downloadAndInstall).toHaveBeenCalledWith(onEvent);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects unknown storage layout at install time without modifying app", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "unsupported", root: "D:/custom" });
    const mockUpdate = createMockUpdate();

    await expect(installUpdateForLayout(mockUpdate)).rejects.toThrow(/Unknown storage layout: unsupported/);
    expect(mockUpdate.downloadAndInstall).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("Consumer: Updater component", () => {
  it("delays mount check until layout is resolved, checking portable target", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "portable", root: "D:/portable" });
    const mockUpdate = createMockUpdate({ version: "2.0.0" });
    checkMock.mockResolvedValue(mockUpdate);

    render(<Updater />);

    expect(await screen.findByTitle(/Update available: 2\.0\.0/)).toBeInTheDocument();
    expect(checkMock).toHaveBeenCalledWith({ target: PORTABLE_UPDATE_TARGET });
  });

  it("surfaces check error and enables retry via visible controls", async () => {
    getPathsMock.mockRejectedValue(new Error("check layout failed"));

    render(<Updater />);

    // R05: errors are not hidden; button with error indicator remains accessible
    const errorBtn = await screen.findByTitle("Update check failed");
    expect(errorBtn).toBeInTheDocument();

    await userEvent.click(errorBtn);
    const tryAgainBtn = await screen.findByRole("button", { name: /Try Again/i });
    expect(tryAgainBtn).toBeInTheDocument();

    // Clicking Try Again performs a fresh check
    getPathsMock.mockResolvedValue({ root_kind: "portable", root: "D:/portable" });
    checkMock.mockResolvedValue(createMockUpdate({ version: "2.0.0" }));
    await userEvent.click(tryAgainBtn);

    await waitFor(() => {
      expect(screen.getByTitle(/Update available: 2\.0\.0/)).toBeInTheDocument();
    });
  });

  it("handles portable install: enters ready state without duplicate frontend relaunch", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "portable", root: "D:/portable" });
    invokeMock.mockResolvedValue(undefined);
    const mockUpdate = createMockUpdate({ version: "2.0.0" });
    checkMock.mockResolvedValue(mockUpdate);

    render(<Updater />);

    const trigger = await screen.findByTitle(/Update available: 2\.0\.0/);
    await userEvent.click(trigger);

    const installBtn = await screen.findByRole("button", { name: /Download & Install Update/i });
    await userEvent.click(installBtn);

    expect(await screen.findByText(/Ready - Restarting\.\.\./i)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("install_portable_update", expect.anything());
    // Native owns restart; frontend does not issue relaunch
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("handles installed update: schedules frontend relaunch", async () => {
    vi.useFakeTimers();
    getPathsMock.mockResolvedValue({ root_kind: "appdata", root: "C:/app" });
    const mockUpdate = createMockUpdate({ version: "2.0.0" });
    checkMock.mockResolvedValue(mockUpdate);

    render(<Updater />);

    await act(async () => {
      await Promise.resolve();
    });

    const trigger = screen.getByTitle(/Update available: 2\.0\.0/);
    await act(async () => {
      trigger.click();
    });

    const installBtn = screen.getByRole("button", { name: /Download & Install Update/i });
    await act(async () => {
      installBtn.click();
    });

    expect(screen.getByText(/Ready - Restarting\.\.\./i)).toBeInTheDocument();
    expect(mockUpdate.downloadAndInstall).toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(relaunchMock).toHaveBeenCalledOnce();
  });
});

describe("Consumer: UpdateSettings component", () => {
  it("checks for updates with resolved portable target", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "portable", root: "D:/portable" });
    checkMock.mockResolvedValue(createMockUpdate({ version: "2.0.0" }));

    render(<UpdateSettings />);

    const checkBtn = screen.getByRole("button", { name: /Проверить обновления/i });
    await userEvent.click(checkBtn);

    expect(await screen.findByText(/Доступно обновление: v2\.0\.0/i)).toBeInTheDocument();
    expect(checkMock).toHaveBeenCalledWith({ target: PORTABLE_UPDATE_TARGET });
  });

  it("surfaces check error and never claims success", async () => {
    getPathsMock.mockRejectedValue(new Error("check failed"));

    render(<UpdateSettings />);

    const checkBtn = screen.getByRole("button", { name: /Проверить обновления/i });
    await userEvent.click(checkBtn);

    expect(await screen.findByText(/Ошибка проверки: check failed/i)).toBeInTheDocument();
    expect(screen.queryByText(/актуальная версия/i)).not.toBeInTheDocument();
  });

  it("portable install invokes native helper and does not call relaunch", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "portable", root: "D:/portable" });
    invokeMock.mockResolvedValue(undefined);
    checkMock.mockResolvedValue(createMockUpdate({ version: "2.0.0" }));

    render(<UpdateSettings />);

    const checkBtn = screen.getByRole("button", { name: /Проверить обновления/i });
    await userEvent.click(checkBtn);

    const installBtn = await screen.findByRole("button", { name: /Установить v2\.0\.0/i });
    await userEvent.click(installBtn);

    expect(invokeMock).toHaveBeenCalledWith("install_portable_update", expect.anything());
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("installed install calls downloadAndInstall and triggers relaunch", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "appdata", root: "C:/app" });
    relaunchMock.mockResolvedValue(undefined);
    const mockUpdate = createMockUpdate({ version: "2.0.0" });
    checkMock.mockResolvedValue(mockUpdate);

    render(<UpdateSettings />);

    const checkBtn = screen.getByRole("button", { name: /Проверить обновления/i });
    await userEvent.click(checkBtn);

    const installBtn = await screen.findByRole("button", { name: /Установить v2\.0\.0/i });
    await userEvent.click(installBtn);

    expect(mockUpdate.downloadAndInstall).toHaveBeenCalled();
    expect(relaunchMock).toHaveBeenCalledOnce();
  });

  it("surfaces install error and does not call relaunch", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "portable", root: "D:/portable" });
    invokeMock.mockRejectedValue(new Error("hash mismatch"));
    checkMock.mockResolvedValue(createMockUpdate({ version: "2.0.0" }));

    render(<UpdateSettings />);

    const checkBtn = screen.getByRole("button", { name: /Проверить обновления/i });
    await userEvent.click(checkBtn);

    const installBtn = await screen.findByRole("button", { name: /Установить v2\.0\.0/i });
    await userEvent.click(installBtn);

    expect(await screen.findByText(/Ошибка установки: hash mismatch/i)).toBeInTheDocument();
    expect(relaunchMock).not.toHaveBeenCalled();
  });
});

describe("Notice and layout presentation", () => {
  it("renders notice for portable layout promising in-place .echo-ai preservation", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "portable", root: "D:/app" });

    render(<ProbeNotice />);

    expect(await screen.findByText(/портативном режиме/i)).toBeInTheDocument();
    expect(screen.getByText(/\.echo-ai/i)).toBeInTheDocument();
  });

  it("remains hidden for installed layout", async () => {
    getPathsMock.mockResolvedValue({ root_kind: "appdata", root: "C:/app" });

    render(<ProbeNotice />);

    expect(await screen.findByTestId("kind")).toHaveTextContent("installed");
    expect(screen.queryByText(/портативном режиме/i)).not.toBeInTheDocument();
  });
});
