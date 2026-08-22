import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createWorkspaceSelectionHandler } = require("./runtime.cjs") as {
  createWorkspaceSelectionHandler(dependencies: {
    showOpenDialog: (window: unknown, options: unknown) => Promise<{ canceled: boolean; filePaths: string[] }>;
    restartServer: (root: string) => Promise<void>;
    reloadWindow: () => Promise<void>;
    setWorkspaceId: (id: string) => void;
  }): (window: unknown) => Promise<{ cancelled: boolean; workspaceId?: string }>;
};

describe("Codgram native folder handoff", () => {
  it("restarts the local server with the chosen project parent and returns only its identifier", async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ["/Users/codgram/Projects/website"] });
    const restartServer = vi.fn().mockResolvedValue(undefined);
    const reloadWindow = vi.fn().mockResolvedValue(undefined);
    const setWorkspaceId = vi.fn();
    const choose = createWorkspaceSelectionHandler({ showOpenDialog, restartServer, reloadWindow, setWorkspaceId });

    await expect(choose({})).resolves.toEqual({ cancelled: false, workspaceId: "website" });
    expect(restartServer).toHaveBeenCalledWith("/Users/codgram/Projects");
    expect(setWorkspaceId).toHaveBeenCalledWith("website");
    expect(reloadWindow).toHaveBeenCalledTimes(1);
  });

  it("does not restart the local server when the user cancels the native picker", async () => {
    const restartServer = vi.fn();
    const choose = createWorkspaceSelectionHandler({ showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }), restartServer, reloadWindow: vi.fn(), setWorkspaceId: vi.fn() });
    await expect(choose({})).resolves.toEqual({ cancelled: true });
    expect(restartServer).not.toHaveBeenCalled();
  });
});
