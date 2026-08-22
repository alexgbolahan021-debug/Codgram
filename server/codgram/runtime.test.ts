import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentProvider } from "./provider";
import { CodgramRuntime } from "./runtime";
import type { CodgramSettings, WorkspaceInspection } from "./types";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codgram-runtime-"));
process.env.CODGRAM_WORKSPACE_ROOT = tempRoot;
process.env.CODGRAM_DATA_DIR = path.join(tempRoot, ".codgram-data");

const settings: CodgramSettings = { provider: "manus-built-in", model: "default", maxIterations: 6, confirmationMode: "dangerous-only", theme: "dark", onboardingCompleted: true };

const provider: AgentProvider = {
  listModels: async () => ["test-model"],
  createPlan: async () => ({ summary: "Create and verify a small file.", steps: [{ id: "step-1", title: "Create file", detail: "Write a tracked file.", status: "pending" }] }),
  nextDecision: async (messages) => {
    const toolWasUsed = messages.some(message => typeof message.content === "string" && message.content.startsWith("Tool result from"));
    return toolWasUsed
      ? { text: "The requested file was written.", toolCalls: [{ id: "finish-1", type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "Created the requested tracked file." }) } }] }
      : { text: "I will create the requested file.", toolCalls: [{ id: "write-1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "src/hello.ts", content: "export const hello = 'codgram';\n" }) } }] };
  },
  createReport: async () => ({ summary: "Created the requested tracked file.", verification: ["File write recorded"], followUps: [] }),
};

async function waitForCompletion(runtime: CodgramRuntime, runId: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const run = await (await import("./history")).localHistory.getRun(runId);
    if (run && ["completed", "failed", "stopped"].includes(run.status)) return run;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for Codgram runtime completion.");
}

async function waitForStatus(runId: string, status: "awaiting_confirmation") {
  for (let attempt = 0; attempt < 80; attempt++) {
    const run = await (await import("./history")).localHistory.getRun(runId);
    if (run?.status === status) return run;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for Codgram status ${status}.`);
}

describe("Codgram agent runtime", () => {
  beforeAll(async () => {
    await fs.mkdir(path.join(tempRoot, "sample-project", "src"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "sample-project", "package.json"), JSON.stringify({ name: "sample-project", dependencies: { react: "19.0.0" } }));
  });

  afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("runs a model-guided, workspace-bounded tool loop and persists a reviewable change", async () => {
    const runtime = new CodgramRuntime(provider);
    const started = await runtime.start("sample-project", "Create a small hello module in the source folder.");
    const completed = await waitForCompletion(runtime, started.id);
    expect(completed.status).toBe("completed");
    expect(completed.changes).toHaveLength(1);
    expect(completed.changes[0]).toMatchObject({ path: "src/hello.ts", kind: "created" });
    expect(await fs.readFile(path.join(tempRoot, "sample-project", "src", "hello.ts"), "utf8")).toContain("codgram");
    expect(completed.activities.some(entry => entry.title === "Plan created")).toBe(true);
  });

  it("restores a completed run’s tracked pre-change checkpoint once", async () => {
    let decisionCount = 0;
    const rollbackProvider: AgentProvider = {
      ...provider,
      nextDecision: async () => {
        decisionCount += 1;
        return decisionCount === 1
          ? { text: "I will create the rollback file.", toolCalls: [{ id: "write-rollback", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "src/rollback.ts", content: "export const rollback = true;\n" }) } }] }
          : { text: "The rollback file is recorded.", toolCalls: [{ id: "finish-rollback", type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "Created the rollback file." }) } }] };
      },
    };
    const runtime = new CodgramRuntime(rollbackProvider);
    const started = await runtime.start("sample-project", "Create a source file that can be rolled back.");
    const completed = await waitForCompletion(runtime, started.id);
    expect(completed.rollbackCheckpoint.entries).toContainEqual(expect.objectContaining({ path: "src/rollback.ts", before: null }));

    const restored = await runtime.rollback(started.id);

    expect(restored.rollbackCheckpoint.status).toBe("restored");
    await expect(fs.access(path.join(tempRoot, "sample-project", "src", "rollback.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(runtime.rollback(started.id)).rejects.toThrow(/already been restored/i);
  });

  it("defers a finish request until a mutation task has a recorded workspace change", async () => {
    let decisionCount = 0;
    const guardedProvider: AgentProvider = {
      ...provider,
      nextDecision: async () => {
        decisionCount += 1;
        if (decisionCount === 1) return { text: "I can finish now.", toolCalls: [{ id: "early-finish", type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "No-op completion." }) } }] };
        if (decisionCount === 2) return { text: "I will make the requested change.", toolCalls: [{ id: "write-after-guard", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "src/guarded.ts", content: "export const guarded = true;\n" }) } }] };
        return { text: "The change is recorded.", toolCalls: [{ id: "finish-after-write", type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "Created the guarded module." }) } }] };
      },
    };
    const runtime = new CodgramRuntime(guardedProvider);
    const started = await runtime.start("sample-project", "Create a guarded source module.");
    const completed = await waitForCompletion(runtime, started.id);
    expect(completed.status).toBe("completed");
    expect(completed.activities.some(entry => entry.title === "Finish request deferred")).toBe(true);
    expect(completed.changes).toContainEqual(expect.objectContaining({ path: "src/guarded.ts", kind: "created" }));
  });

  it("recovers from malformed structured tool arguments without performing the request", async () => {
    let callCount = 0;
    const malformedProvider: AgentProvider = {
      ...provider,
      nextDecision: async () => {
        callCount += 1;
        return callCount === 1
          ? { text: "I will inspect a file.", toolCalls: [{ id: "bad-args", type: "function", function: { name: "read_file", arguments: "{not-json" } }] }
          : { text: "The malformed request was safely rejected.", toolCalls: [{ id: "finish-after-bad", type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "Stopped after rejecting malformed tool arguments." }) } }] };
      },
    };
    const runtime = new CodgramRuntime(malformedProvider);
    const started = await runtime.start("sample-project", "Safely handle a malformed model tool call.");
    const completed = await waitForCompletion(runtime, started.id);
    expect(completed.status).toBe("completed");
    expect(completed.activities.some(entry => entry.title === "Tool request rejected")).toBe(true);
    expect(completed.changes).toHaveLength(0);
  });

  it("requires a confirmation for deletion and cleanly stops when the user declines", async () => {
    const confirmationProvider: AgentProvider = {
      ...provider,
      nextDecision: async () => ({ text: "I need to delete an obsolete file.", toolCalls: [{ id: "delete-1", type: "function", function: { name: "delete_file", arguments: JSON.stringify({ path: "obsolete.ts" }) } }] }),
    };
    const runtime = new CodgramRuntime(confirmationProvider);
    const started = await runtime.start("sample-project", "Delete an obsolete file only after confirmation.");
    const awaiting = await waitForStatus(started.id, "awaiting_confirmation");
    expect(awaiting.pendingAction?.toolName).toBe("delete_file");
    const stopped = await runtime.confirm(started.id, false);
    expect(stopped.status).toBe("stopped");
    expect(stopped.finalReport?.summary).toContain("declined");
  });

  it("executes an approved deletion, records the change, and safely resumes the agent loop", async () => {
    await fs.writeFile(path.join(tempRoot, "sample-project", "obsolete-approve.ts"), "export const obsolete = true;\n");
    let decisionCount = 0;
    const approvalProvider: AgentProvider = {
      ...provider,
      nextDecision: async () => {
        decisionCount += 1;
        return decisionCount === 1
          ? { text: "I need approval before deleting this obsolete file.", toolCalls: [{ id: "delete-approved", type: "function", function: { name: "delete_file", arguments: JSON.stringify({ path: "obsolete-approve.ts" }) } }] }
          : { text: "The approved deletion is complete.", toolCalls: [{ id: "finish-approved", type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "Deleted the approved obsolete file." }) } }] };
      },
    };
    const runtime = new CodgramRuntime(approvalProvider);
    const started = await runtime.start("sample-project", "Delete the approved obsolete file.");
    await waitForStatus(started.id, "awaiting_confirmation");
    await runtime.confirm(started.id, true);
    const completed = await waitForCompletion(runtime, started.id);
    expect(completed.status).toBe("completed");
    expect(completed.changes).toContainEqual(expect.objectContaining({ path: "obsolete-approve.ts", kind: "deleted" }));
    await expect(fs.access(path.join(tempRoot, "sample-project", "obsolete-approve.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records a recoverable tool error and continues to a controlled completion", async () => {
    let decisionCount = 0;
    const recoveryProvider: AgentProvider = {
      ...provider,
      nextDecision: async () => {
        decisionCount += 1;
        return decisionCount === 1
          ? { text: "I will inspect a file that may not exist.", toolCalls: [{ id: "missing-file", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "not-present.ts" }) } }] }
          : { text: "The missing file was reported safely.", toolCalls: [{ id: "finish-recovery", type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "Completed after handling a recoverable file-read error." }) } }] };
      },
    };
    const runtime = new CodgramRuntime(recoveryProvider);
    const started = await runtime.start("sample-project", "Handle a missing file safely.");
    const completed = await waitForCompletion(runtime, started.id);
    expect(completed.status).toBe("completed");
    expect(completed.activities.some(entry => entry.title === "read_file failed")).toBe(true);
    expect(completed.finalReport?.summary).toBeTruthy();
  });
});
