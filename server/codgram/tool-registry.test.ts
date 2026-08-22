import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeCodgramTool } from "./tool-registry";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "codgram-tools-"));
process.env.CODGRAM_WORKSPACE_ROOT = root;

describe("Codgram file-write confirmation mode", () => {
  beforeAll(async () => {
    await fs.mkdir(path.join(root, "project"), { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("pauses before a file write when all-writes confirmation is enabled", async () => {
    const result = await executeCodgramTool("project", "write_file", { path: "safe.ts", content: "export const safe = true;\n" }, false, "all-writes");
    expect(result.requiresConfirmation).toMatchObject({ toolName: "write_file" });
    await expect(fs.access(path.join(root, "project", "safe.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
