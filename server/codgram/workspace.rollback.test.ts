import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRollbackCheckpoint, recordRollbackChange } from "./checkpoint";
import { workspaceService } from "./workspace";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "codgram-rollback-"));
const previousRoot = process.env.CODGRAM_WORKSPACE_ROOT;
const previousLock = process.env.CODGRAM_WORKSPACE_ID;

function restoreEnv(key: "CODGRAM_WORKSPACE_ROOT" | "CODGRAM_WORKSPACE_ID", value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("Codgram workspace rollback", () => {
  beforeAll(async () => {
    await fs.mkdir(path.join(root, "selected-project", "src"), { recursive: true });
    await fs.writeFile(path.join(root, "selected-project", "package.json"), JSON.stringify({ name: "selected-project" }));
    process.env.CODGRAM_WORKSPACE_ROOT = root;
    process.env.CODGRAM_WORKSPACE_ID = "selected-project";
  });

  afterAll(async () => {
    restoreEnv("CODGRAM_WORKSPACE_ROOT", previousRoot);
    restoreEnv("CODGRAM_WORKSPACE_ID", previousLock);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("restores a tracked file only when its current contents match the recorded post-run state", async () => {
    await fs.writeFile(path.join(root, "selected-project", "src", "feature.ts"), "export const version = 1;\n");
    const change = await workspaceService.writeFile("selected-project", "src/feature.ts", "export const version = 2;\n");
    const checkpoint = recordRollbackChange(createRollbackCheckpoint(), change);

    const restored = await workspaceService.restoreCheckpoint("selected-project", checkpoint.entries);

    expect(restored).toHaveLength(1);
    await expect(fs.readFile(path.join(root, "selected-project", "src", "feature.ts"), "utf8")).resolves.toContain("version = 1");
  });

  it("refuses to overwrite a newer workspace change during restore", async () => {
    const change = await workspaceService.writeFile("selected-project", "src/conflict.ts", "export const version = 2;\n");
    const checkpoint = recordRollbackChange(createRollbackCheckpoint(), change);
    await fs.writeFile(path.join(root, "selected-project", "src", "conflict.ts"), "export const version = 3;\n");

    await expect(workspaceService.restoreCheckpoint("selected-project", checkpoint.entries)).rejects.toThrow(/will not overwrite a newer change/i);
  });
});
