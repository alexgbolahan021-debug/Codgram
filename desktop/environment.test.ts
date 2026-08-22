import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createCodgramDesktopEnvironment } = require("./environment.cjs") as {
  createCodgramDesktopEnvironment(base: Record<string, string | undefined>, selection: { port: number; workspaceRoot: string; workspaceId: string | null; isPackaged: boolean; providerApiKey?: string | null }): Record<string, string | undefined>;
};
const { createWorkspaceSelectionHandler } = require("./runtime.cjs") as {
  createWorkspaceSelectionHandler(dependencies: {
    showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
    restartServer: (root: string) => Promise<void>;
    reloadWindow: () => Promise<void>;
    setWorkspaceId: (id: string) => void;
  }): () => Promise<{ cancelled: boolean; workspaceId?: string }>;
};
const { createDesktopWorkspaceState } = require("./state.cjs") as {
  createDesktopWorkspaceState(): { getWorkspaceId(): string | null; setWorkspaceId(value: string | null): void; toRendererState(): { isDesktop: true; workspaceId: string | null } };
};

describe("Codgram desktop selection environment handoff", () => {
  it("passes the selected project parent and identifier from the native picker into a locked local-server environment", async () => {
    const workspaceState = createDesktopWorkspaceState();
    const restartServer = vi.fn().mockResolvedValue(undefined);
    const chooseProject = createWorkspaceSelectionHandler({
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ["/Users/codgram/Projects/website"] }),
      restartServer,
      reloadWindow: vi.fn().mockResolvedValue(undefined),
      setWorkspaceId: id => workspaceState.setWorkspaceId(id),
    });

    await expect(chooseProject()).resolves.toEqual({ cancelled: false, workspaceId: "website" });
    expect(restartServer).toHaveBeenCalledWith("/Users/codgram/Projects");
    expect(createCodgramDesktopEnvironment({ EXISTING_FLAG: "kept" }, {
      port: 4599,
      workspaceRoot: "/Users/codgram/Projects",
      workspaceId: workspaceState.getWorkspaceId(),
      isPackaged: false,
    })).toMatchObject({
      EXISTING_FLAG: "kept",
      PORT: "4599",
      CODGRAM_WORKSPACE_ROOT: "/Users/codgram/Projects",
      CODGRAM_WORKSPACE_ID: "website",
      NODE_ENV: "development",
    });
    expect(workspaceState.toRendererState()).toEqual({ isDesktop: true, workspaceId: "website" });
  });

  it("hands a decrypted protected provider secret only to the local server environment", () => {
    const environment = createCodgramDesktopEnvironment({ EXISTING_FLAG: "kept" }, {
      port: 4599,
      workspaceRoot: "/Users/codgram/Projects",
      workspaceId: "website",
      isPackaged: true,
      providerApiKey: "protected-value",
    });
    expect(environment).toMatchObject({ CODGRAM_OPENAI_API_KEY: "protected-value", NODE_ENV: "production" });
    expect(createCodgramDesktopEnvironment({}, { port: 4599, workspaceRoot: "/tmp", workspaceId: null, isPackaged: false })).not.toHaveProperty("CODGRAM_OPENAI_API_KEY");
  });
});
