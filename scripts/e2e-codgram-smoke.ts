import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { localHistory } from "../server/codgram/history";
import { CodgramRuntime } from "../server/codgram/runtime";
import { DEFAULT_SETTINGS } from "../server/codgram/types";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "codgram-e2e-"));
const projectName = "sample-project";
const projectPath = path.join(root, projectName);
process.env.CODGRAM_WORKSPACE_ROOT = root;
process.env.CODGRAM_DATA_DIR = path.join(root, ".codgram-data");
let succeeded = false;

async function waitForTerminalRun(runId: string) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const run = await localHistory.getRun(runId);
    if (run && ["completed", "failed", "stopped"].includes(run.status)) return run;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the Codgram agent run to reach a terminal state.");
}

try {
  await fs.mkdir(path.join(projectPath, "src"), { recursive: true });
  await fs.writeFile(path.join(projectPath, "package.json"), JSON.stringify({ name: "codgram-e2e-sample", private: true, scripts: { test: "node --test" } }, null, 2));
  await fs.writeFile(path.join(projectPath, "src", "index.ts"), "export const projectName = 'Codgram E2E sample';\n");
  await localHistory.saveSettings({ ...DEFAULT_SETTINGS, maxIterations: 8, confirmationMode: "dangerous-only" });

  const runtime = new CodgramRuntime();
  const run = await runtime.start(projectName, "Inspect this project, then create a new file named SMOKE_TEST.md at the workspace root containing exactly: Codgram end-to-end smoke test passed. Do not use terminal or Git tools. After the tracked write, finish the task with a concise report.");
  const completed = await waitForTerminalRun(run.id);
  const smokeFile = await fs.readFile(path.join(projectPath, "SMOKE_TEST.md"), "utf8").catch(() => "");
  const result = {
    status: completed.status,
    iterationCount: completed.iteration,
    activityCount: completed.activities.length,
    changes: completed.changes.map(change => ({ path: change.path, kind: change.kind })),
    commandCount: completed.commands.length,
    smokeFileExact: smokeFile === "Codgram end-to-end smoke test passed.",
    finalSummary: completed.finalReport?.summary || null,
    error: completed.error,
  };
  console.log(JSON.stringify(result, null, 2));
  if (completed.status !== "completed" || !result.smokeFileExact || !completed.changes.some(change => change.path === "SMOKE_TEST.md" && change.kind === "created")) {
    throw new Error("Codgram smoke test did not produce the expected completed tracked file change.");
  }
  succeeded = true;
} catch (error) {
  console.error(error);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

process.exit(succeeded ? 0 : 1);
