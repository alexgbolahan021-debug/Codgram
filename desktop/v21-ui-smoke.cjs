const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let output = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 45_000);
    child.stdout.on("data", chunk => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", chunk => { output += chunk; process.stderr.write(chunk); });
    child.on("error", reject);
    child.on("exit", code => {
      clearTimeout(timeout);
      code === 0 ? resolve(output) : reject(new Error(`Desktop smoke command exited with ${code}.\n${output}`));
    });
  });
}

function runRecord(workspaceId, checkpointPath, expectedAfter) {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000001",
    workspaceId,
    workspaceName: workspaceId,
    task: "Create a rollback smoke file.",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    inspection: { name: workspaceId, framework: "Node.js", language: "TypeScript", packageManager: "pnpm", hasGit: false, stackSignals: [] },
    plan: null,
    activities: [],
    changes: [{ id: "change", path: checkpointPath, kind: "created", before: null, after: expectedAfter, diff: "", at: now }],
    rollbackCheckpoint: { id: "checkpoint", createdAt: now, status: "ready", entries: [{ path: checkpointPath, before: null, expectedAfter }] },
    commands: [],
    pendingAction: null,
    iteration: 1,
    stopRequested: false,
    finalReport: { summary: "V2.1 desktop checkpoint smoke run.", verification: [], followUps: [] },
    error: null,
  };
}

async function verifyMode(mode) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `codgram-v21-ui-${mode}-`));
  const dataDir = path.join(temp, "data");
  const workspaceId = "CodgramV21UiSmoke";
  const project = path.join(temp, workspaceId);
  const file = path.join(project, "src", "rollback-ui.ts");
  const expectedAfter = "export const checkpoint = 'after';\n";
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ name: workspaceId }));
    await fs.writeFile(file, mode === "conflict" ? "export const checkpoint = 'newer';\n" : expectedAfter);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, "runs.json"), JSON.stringify({ runs: [runRecord(workspaceId, "src/rollback-ui.ts", expectedAfter)] }, null, 2));
    const output = await run("xvfb-run", ["-a", "pnpm", "exec", "electron", "desktop/main.cjs"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, CODGRAM_DESKTOP_PORT: mode === "success" ? "4691" : "4692", CODGRAM_DATA_DIR: dataDir, CODGRAM_DESKTOP_SMOKE_PROJECT: project, CODGRAM_DESKTOP_V21_UI_SMOKE: mode },
    });
    if (!output.includes(`[Codgram desktop V2.1 UI smoke] ${mode} flow passed`)) throw new Error(`The ${mode} desktop flow did not emit its success marker.`);
    const savedSettings = JSON.parse(await fs.readFile(path.join(dataDir, "settings.json"), "utf8"));
    if (savedSettings.provider !== "openai-compatible" || savedSettings.model !== "smoke-coder" || savedSettings.onboardingCompleted !== true) {
      throw new Error("The native onboarding flow did not persist its selected provider, model preference, and completion state locally.");
    }
    if (mode === "success") {
      await fs.access(file).then(() => { throw new Error("The successful checkpoint restore did not remove the created smoke file."); }).catch(error => {
        if ((error && error.code) !== "ENOENT") throw error;
      });
    }
    if (mode === "conflict") {
      const actual = await fs.readFile(file, "utf8");
      if (actual !== "export const checkpoint = 'newer';\n") throw new Error("The conflict-safe restore unexpectedly overwrote newer work.");
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function main() {
  await verifyMode("success");
  await verifyMode("conflict");
  console.log("[Codgram desktop V2.1 UI smoke] all flows passed");
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
