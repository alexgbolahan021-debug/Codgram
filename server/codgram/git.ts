import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { redactSecrets } from "./security";
import type { CommandResult } from "./types";

async function runGit(cwd: string, args: string[]) {
  const started = Date.now();
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", error => reject(new Error(redactSecrets(error.message))));
    child.once("close", code => resolve({ id: randomUUID(), command: `git ${args.join(" ")}`, stdout: redactSecrets(stdout).slice(0, 40_000), stderr: redactSecrets(stderr).slice(0, 40_000), exitCode: code ?? 1, durationMs: Date.now() - started, at: new Date().toISOString() }));
  });
}

export const gitTools = {
  status: (cwd: string) => runGit(cwd, ["status", "--short", "--branch"]),
  diff: (cwd: string) => runGit(cwd, ["diff", "--no-ext-diff", "--unified=3"]),
  log: (cwd: string) => runGit(cwd, ["log", "--oneline", "-12"]),
  createBranch: (cwd: string, name: string) => runGit(cwd, ["switch", "-c", name]),
  commit: (cwd: string, message: string) => runGit(cwd, ["commit", "-am", message]),
};
