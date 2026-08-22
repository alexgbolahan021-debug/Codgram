import path from "node:path";
import type { Tool } from "../_core/llm";
import { gitTools } from "./git";
import { getLockedWorkspaceId, getWorkspaceRoot, normalizeWorkspaceId, resolveInside } from "./security";
import { assessCommand, runValidatedCommand } from "./terminal";
import type { CodgramSettings, ToolExecutionResult } from "./types";
import { workspaceService } from "./workspace";

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

export const CODGRAM_TOOLS: Tool[] = [
  { type: "function", function: { name: "list_directory", description: "List a safe directory inside the active workspace.", parameters: objectSchema({ path: { type: "string" } }) } },
  { type: "function", function: { name: "read_file", description: "Read a non-secret, non-generated text file inside the active workspace.", parameters: objectSchema({ path: { type: "string" } }, ["path"]) } },
  { type: "function", function: { name: "search_files", description: "Search safe source files inside the active workspace.", parameters: objectSchema({ query: { type: "string" } }, ["query"]) } },
  { type: "function", function: { name: "write_file", description: "Create or replace a file inside the active workspace. Explain why in content planning first.", parameters: objectSchema({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]) } },
  { type: "function", function: { name: "edit_file", description: "Safely replace one exact existing text range inside a workspace file.", parameters: objectSchema({ path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } }, ["path", "oldText", "newText"]) } },
  { type: "function", function: { name: "delete_file", description: "Request deletion of a workspace file. This always requires explicit confirmation.", parameters: objectSchema({ path: { type: "string" } }, ["path"]) } },
  { type: "function", function: { name: "terminal", description: "Run one validated package-manager build, test, lint, typecheck, or dependency command in the active workspace.", parameters: objectSchema({ command: { type: "string" } }, ["command"]) } },
  { type: "function", function: { name: "git_status", description: "Inspect Git status without changing repository state.", parameters: objectSchema({}) } },
  { type: "function", function: { name: "git_diff", description: "Inspect local Git diff without changing repository state.", parameters: objectSchema({}) } },
  { type: "function", function: { name: "git_log", description: "Inspect recent local commits without changing repository state.", parameters: objectSchema({}) } },
  { type: "function", function: { name: "git_create_branch", description: "Request creation of a local checkpoint branch. This always requires explicit confirmation.", parameters: objectSchema({ name: { type: "string" } }, ["name"]) } },
  { type: "function", function: { name: "git_commit", description: "Request a local commit. This always requires explicit confirmation and never pushes.", parameters: objectSchema({ message: { type: "string" } }, ["message"]) } },
  { type: "function", function: { name: "finish", description: "Finish only after inspecting final changes and running relevant verification.", parameters: objectSchema({ summary: { type: "string" } }, ["summary"]) } },
];

function asString(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== "string") throw new Error(`Tool argument '${key}' must be a string.`);
  return value;
}

function workspaceCwd(workspaceId: string) {
  const normalized = normalizeWorkspaceId(workspaceId);
  const locked = getLockedWorkspaceId();
  if (locked && normalized !== locked) throw new Error("Codgram is locked to the project selected in the desktop shell.");
  return resolveInside(getWorkspaceRoot(), normalized);
}

export async function executeCodgramTool(workspaceId: string, toolName: string, args: Record<string, unknown>, allowDestructive = false, confirmationMode: CodgramSettings["confirmationMode"] = "dangerous-only"): Promise<ToolExecutionResult> {
  if (toolName === "list_directory") {
    const items = await workspaceService.listDirectory(workspaceId, typeof args.path === "string" ? args.path : "");
    return { content: JSON.stringify(items) };
  }
  if (toolName === "read_file") return { content: await workspaceService.readFile(workspaceId, asString(args, "path")) };
  if (toolName === "search_files") return { content: JSON.stringify(await workspaceService.searchFiles(workspaceId, asString(args, "query"))) };
  if (toolName === "write_file") {
    if (confirmationMode === "all-writes" && !allowDestructive) return { content: "Confirmation required before writing a file.", requiresConfirmation: { toolName, arguments: args, reason: "Your current safety setting requires approval before every file write.", preview: `Write ${asString(args, "path")} inside the active workspace` } };
    const change = await workspaceService.writeFile(workspaceId, asString(args, "path"), asString(args, "content"));
    return { content: `Recorded ${change.kind}: ${change.path}`, change };
  }
  if (toolName === "edit_file") {
    if (confirmationMode === "all-writes" && !allowDestructive) return { content: "Confirmation required before editing a file.", requiresConfirmation: { toolName, arguments: args, reason: "Your current safety setting requires approval before every file edit.", preview: `Edit ${asString(args, "path")} inside the active workspace` } };
    const change = await workspaceService.editFile(workspaceId, asString(args, "path"), asString(args, "oldText"), asString(args, "newText"));
    return { content: `Recorded edit: ${change.path}`, change };
  }
  if (toolName === "delete_file") {
    const preview = `Delete ${asString(args, "path")} from the active workspace`;
    if (!allowDestructive) return { content: "Confirmation required before deleting a file.", requiresConfirmation: { toolName, arguments: args, reason: "Deleting a file is destructive and cannot be automatically reversed.", preview } };
    const change = await workspaceService.deleteFile(workspaceId, asString(args, "path"));
    return { content: `Recorded deletion: ${change.path}`, change };
  }
  if (toolName === "terminal") {
    const command = asString(args, "command");
    const assessment = assessCommand(command);
    if (!assessment.approved) throw new Error(assessment.reason);
    if (assessment.requiresConfirmation && !allowDestructive) return { content: "Confirmation required before modifying dependencies.", requiresConfirmation: { toolName, arguments: args, reason: "Dependency changes can alter the workspace lockfile and execute package lifecycle scripts.", preview: command } };
    const commandResult = await runValidatedCommand(command, workspaceCwd(workspaceId));
    return { content: JSON.stringify(commandResult), command: commandResult };
  }
  if (toolName === "git_status") { const command = await gitTools.status(workspaceCwd(workspaceId)); return { content: JSON.stringify(command), command }; }
  if (toolName === "git_diff") { const command = await gitTools.diff(workspaceCwd(workspaceId)); return { content: JSON.stringify(command), command }; }
  if (toolName === "git_log") { const command = await gitTools.log(workspaceCwd(workspaceId)); return { content: JSON.stringify(command), command }; }
  if (toolName === "git_create_branch") {
    const name = asString(args, "name");
    if (!/^[-a-zA-Z0-9_/.]+$/.test(name)) throw new Error("Use a simple local Git branch name.");
    if (!allowDestructive) return { content: "Confirmation required before creating a branch.", requiresConfirmation: { toolName, arguments: args, reason: "Creating a branch changes local Git state.", preview: `git switch -c ${name}` } };
    const command = await gitTools.createBranch(workspaceCwd(workspaceId), name);
    return { content: JSON.stringify(command), command };
  }
  if (toolName === "git_commit") {
    const message = asString(args, "message");
    if (!allowDestructive) return { content: "Confirmation required before committing changes.", requiresConfirmation: { toolName, arguments: args, reason: "Committing writes a durable local Git checkpoint. Codgram never pushes commits.", preview: `git commit -am ${JSON.stringify(message)}` } };
    const command = await gitTools.commit(workspaceCwd(workspaceId), message);
    return { content: JSON.stringify(command), command };
  }
  if (toolName === "finish") return { content: asString(args, "summary"), finish: true };
  throw new Error(`Codgram does not recognize tool '${toolName}'.`);
}
