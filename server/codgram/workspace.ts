import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getLockedWorkspaceId, getWorkspaceRoot, isIgnoredWorkspacePath, isSensitivePath, normalizeWorkspaceId, resolveInside } from "./security";
import type { FileChange, WorkspaceInspection } from "./types";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_TREE_ITEMS = 80;
const MAX_SEARCH_RESULTS = 60;

type DirectoryItem = { path: string; kind: "file" | "directory" };

async function exists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readText(target: string): Promise<string> {
  const stat = await fs.stat(target);
  if (stat.size > MAX_FILE_BYTES) throw new Error("Codgram will not load files larger than 256 KB into agent context.");
  return fs.readFile(target, "utf8");
}

function createDiff(filePath: string, before: string | null, after: string | null): string {
  const oldLines = (before ?? "").split("\n");
  const newLines = (after ?? "").split("\n");
  const limit = Math.max(oldLines.length, newLines.length);
  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`];
  for (let index = 0; index < limit; index++) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine) continue;
    if (oldLine !== undefined) lines.push(`-${oldLine}`);
    if (newLine !== undefined) lines.push(`+${newLine}`);
  }
  return lines.slice(0, 500).join("\n");
}

export class WorkspaceService {
  private root(): string {
    return getWorkspaceRoot();
  }

  private workspacePath(workspaceId: string): string {
    const normalized = normalizeWorkspaceId(workspaceId);
    const locked = getLockedWorkspaceId();
    if (locked && normalized !== locked) throw new Error("Codgram is locked to the project selected in the desktop shell.");
    return resolveInside(this.root(), normalized);
  }

  private filePath(workspaceId: string, relativePath: string): string {
    if (isSensitivePath(relativePath)) throw new Error("Codgram blocks access to secret-bearing files.");
    if (isIgnoredWorkspacePath(relativePath)) throw new Error("Codgram does not inspect generated or dependency directories.");
    return resolveInside(this.workspacePath(workspaceId), relativePath);
  }

  async listWorkspaces() {
    const root = this.root();
    const locked = getLockedWorkspaceId();
    if (locked) {
      const target = this.workspacePath(locked);
      const stat = await fs.stat(target);
      if (!stat.isDirectory()) throw new Error("The Codgram desktop project selection is not a directory.");
      return [{ id: locked, name: locked }];
    }
    const entries = await fs.readdir(root, { withFileTypes: true });
    const workspaces = await Promise.all(entries.filter(entry => entry.isDirectory() && !entry.name.startsWith(".")).map(async entry => {
      const target = path.join(root, entry.name);
      const useful = await Promise.all(["package.json", ".git", "README.md", "pyproject.toml", "Cargo.toml"].map(marker => exists(path.join(target, marker))));
      return useful.some(Boolean) ? { id: entry.name, name: entry.name } : null;
    }));
    return workspaces.filter((workspace): workspace is { id: string; name: string } => workspace !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  async listDirectory(workspaceId: string, relativePath = ""): Promise<DirectoryItem[]> {
    const target = relativePath ? this.filePath(workspaceId, relativePath) : this.workspacePath(workspaceId);
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries
      .filter(entry => !entry.name.startsWith(".") && !isIgnoredWorkspacePath(path.posix.join(relativePath, entry.name)))
      .slice(0, MAX_TREE_ITEMS)
      .map(entry => ({ path: path.posix.join(relativePath, entry.name), kind: entry.isDirectory() ? "directory" : "file" }));
  }

  async readFile(workspaceId: string, relativePath: string) {
    return readText(this.filePath(workspaceId, relativePath));
  }

  async searchFiles(workspaceId: string, query: string) {
    if (!query.trim() || query.length > 160) throw new Error("Provide a concise project search query.");
    const workspace = this.workspacePath(workspaceId);
    const results: Array<{ path: string; line: number; text: string }> = [];
    const needle = query.toLocaleLowerCase();

    const visit = async (relative = "", depth = 0): Promise<void> => {
      if (depth > 5 || results.length >= MAX_SEARCH_RESULTS) return;
      const current = relative ? resolveInside(workspace, relative) : workspace;
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= MAX_SEARCH_RESULTS) break;
        const child = path.posix.join(relative, entry.name);
        if (entry.name.startsWith(".") || isIgnoredWorkspacePath(child) || isSensitivePath(child)) continue;
        if (entry.isDirectory()) {
          await visit(child, depth + 1);
          continue;
        }
        try {
          const content = await readText(resolveInside(workspace, child));
          content.split("\n").forEach((line, index) => {
            if (results.length < MAX_SEARCH_RESULTS && line.toLocaleLowerCase().includes(needle)) {
              results.push({ path: child, line: index + 1, text: line.slice(0, 300) });
            }
          });
        } catch {
          // Binary, unreadable, or oversized files are deliberately excluded from context.
        }
      }
    };

    await visit();
    return results;
  }

  async writeFile(workspaceId: string, relativePath: string, content: string): Promise<FileChange> {
    if (content.length > MAX_FILE_BYTES) throw new Error("Codgram will not write files larger than 256 KB in one action.");
    const target = this.filePath(workspaceId, relativePath);
    const before = await exists(target) ? await readText(target) : null;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    return {
      id: randomUUID(),
      path: relativePath,
      kind: before === null ? "created" : "edited",
      before,
      after: content,
      diff: createDiff(relativePath, before, content),
      at: new Date().toISOString(),
    };
  }

  async editFile(workspaceId: string, relativePath: string, oldText: string, newText: string): Promise<FileChange> {
    if (!oldText) throw new Error("Codgram requires the expected existing text for a safe edit.");
    const target = this.filePath(workspaceId, relativePath);
    const before = await readText(target);
    const matches = before.split(oldText).length - 1;
    if (matches !== 1) throw new Error(matches === 0 ? "The requested text was not found." : "The requested text is ambiguous; inspect the file and use a unique match.");
    const after = before.replace(oldText, newText);
    await fs.writeFile(target, after, "utf8");
    return {
      id: randomUUID(),
      path: relativePath,
      kind: "edited",
      before,
      after,
      diff: createDiff(relativePath, before, after),
      at: new Date().toISOString(),
    };
  }

  async deleteFile(workspaceId: string, relativePath: string): Promise<FileChange> {
    const target = this.filePath(workspaceId, relativePath);
    const before = await readText(target);
    await fs.unlink(target);
    return {
      id: randomUUID(),
      path: relativePath,
      kind: "deleted",
      before,
      after: null,
      diff: createDiff(relativePath, before, null),
      at: new Date().toISOString(),
    };
  }

  async inspect(workspaceId: string): Promise<WorkspaceInspection> {
    const workspace = this.workspacePath(workspaceId);
    const name = path.basename(workspace);
    const rootItems = await this.listDirectory(workspaceId);
    const filenames = rootItems.map(item => item.path);
    const packagePath = path.join(workspace, "package.json");
    let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null = null;
    try {
      packageJson = JSON.parse(await readText(packagePath));
    } catch {
      packageJson = null;
    }
    const dependencies = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
    const signals: string[] = [];
    let framework = "Unidentified project";
    let language = "Unknown";
    if (dependencies.next || filenames.includes("next.config.js") || filenames.includes("next.config.ts")) { framework = "Next.js"; language = "TypeScript/JavaScript"; signals.push("Next.js configuration detected"); }
    else if (dependencies.vite || filenames.includes("vite.config.ts") || filenames.includes("vite.config.js")) { framework = "Vite"; language = "TypeScript/JavaScript"; signals.push("Vite configuration detected"); }
    else if (dependencies.react) { framework = "React"; language = "TypeScript/JavaScript"; signals.push("React dependency detected"); }
    else if (filenames.includes("pyproject.toml") || filenames.includes("requirements.txt")) { framework = "Python application"; language = "Python"; signals.push("Python project files detected"); }
    else if (filenames.includes("Cargo.toml")) { framework = "Rust application"; language = "Rust"; signals.push("Cargo manifest detected"); }
    else if (filenames.includes("go.mod")) { framework = "Go application"; language = "Go"; signals.push("Go module detected"); }
    if (filenames.includes("tsconfig.json")) { language = "TypeScript"; signals.push("TypeScript configuration detected"); }
    const packageManager = (await exists(path.join(workspace, "pnpm-lock.yaml"))) ? "pnpm" : (await exists(path.join(workspace, "yarn.lock"))) ? "yarn" : (await exists(path.join(workspace, "package-lock.json"))) ? "npm" : packageJson ? "npm" : null;
    const hasGit = await exists(path.join(workspace, ".git"));
    if (hasGit) signals.push("Git repository detected");
    return { id: workspaceId, name, relativePath: normalizeWorkspaceId(workspaceId), framework, language, packageManager, hasGit, gitSummary: hasGit ? "Repository available for safe inspection" : "No Git repository detected", files: filenames, stackSignals: signals };
  }
}

export const workspaceService = new WorkspaceService();
