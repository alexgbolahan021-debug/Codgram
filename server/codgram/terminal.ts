import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { redactSecrets } from "./security";
import type { CommandResult } from "./types";

const SHELL_SYNTAX = /[;&|`$<>\n\r]/;
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const DISALLOWED_SCRIPTS = new Set(["dev", "start", "serve", "preview"]);

type CommandAssessment = { approved: boolean; reason?: string; args: string[]; requiresConfirmation: boolean };

function splitCommand(command: string): string[] {
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return parts.map(part => part.replace(/^['"]|['"]$/g, ""));
}

export function assessCommand(command: string): CommandAssessment {
  const trimmed = command.trim();
  if (!trimmed) return { approved: false, reason: "A command is required.", args: [], requiresConfirmation: false };
  if (SHELL_SYNTAX.test(trimmed)) return { approved: false, reason: "Shell chaining, redirection, substitutions, and multi-command execution are blocked.", args: [], requiresConfirmation: false };
  const args = splitCommand(trimmed);
  const executable = args[0];
  if (!executable || !PACKAGE_MANAGERS.has(executable)) return { approved: false, reason: "Only package-manager build, test, lint, and install commands may run through Codgram.", args, requiresConfirmation: false };
  const action = args[1] || "";
  const script = action === "run" ? args[2] : action;
  if (DISALLOWED_SCRIPTS.has(script)) return { approved: false, reason: "Long-running development servers are intentionally blocked. Use build, test, lint, or typecheck instead.", args, requiresConfirmation: false };
  const requiresConfirmation = ["install", "add", "remove", "uninstall", "update"].includes(action);
  return { approved: true, args, requiresConfirmation };
}

export async function runValidatedCommand(command: string, cwd: string): Promise<CommandResult> {
  const assessment = assessCommand(command);
  if (!assessment.approved) throw new Error(assessment.reason);
  const [executable, ...args] = assessment.args;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, shell: false, env: { ...process.env, npm_config_loglevel: "error" } });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(null, "Codgram stopped the command after 60 seconds.");
    }, 60_000);
    const finish = (exitCode: number | null, timeoutMessage?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ id: randomUUID(), command, stdout: redactSecrets(stdout).slice(0, 40_000), stderr: redactSecrets(`${stderr}${timeoutMessage ? `\n${timeoutMessage}` : ""}`).slice(0, 40_000), exitCode, durationMs: Date.now() - started, at: new Date().toISOString() });
    };
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", error => reject(new Error(redactSecrets(error.message))));
    child.once("close", code => finish(code));
  });
}
