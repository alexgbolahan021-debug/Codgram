import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workspaceService } from "./workspace";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "codgram-desktop-lock-"));
const previousRoot = process.env.CODGRAM_WORKSPACE_ROOT;
const previousLock = process.env.CODGRAM_WORKSPACE_ID;

function restore(key: "CODGRAM_WORKSPACE_ROOT" | "CODGRAM_WORKSPACE_ID", value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("Codgram desktop workspace lock", () => {
  beforeAll(async () => {
    await Promise.all(["selected-project", "other-project"].map(name => fs.mkdir(path.join(root, name), { recursive: true })));
    await Promise.all(["selected-project", "other-project"].map(name => fs.writeFile(path.join(root, name, "package.json"), JSON.stringify({ name }))));
    process.env.CODGRAM_WORKSPACE_ROOT = root;
    process.env.CODGRAM_WORKSPACE_ID = "selected-project";
  });

  afterAll(async () => {
    restore("CODGRAM_WORKSPACE_ROOT", previousRoot);
    restore("CODGRAM_WORKSPACE_ID", previousLock);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("exposes only the project selected by the native desktop shell", async () => {
    await expect(workspaceService.listWorkspaces()).resolves.toEqual([{ id: "selected-project", name: "selected-project" }]);
  });

  it("rejects filesystem inspection outside the native selected project", async () => {
    await expect(workspaceService.inspect("other-project")).rejects.toThrow(/locked to the project selected/i);
  });
});
