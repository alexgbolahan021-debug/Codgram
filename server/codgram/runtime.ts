import { randomUUID } from "node:crypto";
import { createRollbackCheckpoint, recordRollbackChange } from "./checkpoint";
import { AgentContextManager } from "./context";
import { localHistory } from "./history";
import { writeLocalLog } from "./logger";
import { defaultProvider, type AgentProvider } from "./provider";
import { redactSecrets } from "./security";
import { executeCodgramTool } from "./tool-registry";
import type { AgentPlan, CompletionReport, CodgramRun, CodgramSettings, PendingAction, RunActivity } from "./types";
import { workspaceService } from "./workspace";

type RuntimeSession = { context: AgentContextManager };

function activity(level: RunActivity["level"], title: string, detail: string, toolName?: string): RunActivity {
  return { id: randomUUID(), at: new Date().toISOString(), level, title, detail: redactSecrets(detail).slice(0, 1_000), toolName };
}

function fallbackReport(run: CodgramRun, finishSummary?: string): CompletionReport {
  const verification = run.commands.map(command => `${command.command} — ${command.exitCode === 0 ? "passed" : command.exitCode === null ? "stopped" : `failed (exit ${command.exitCode})`}`);
  return { summary: finishSummary || `Codgram completed ${run.changes.length} tracked change${run.changes.length === 1 ? "" : "s"}.`, verification: verification.length ? verification : ["No terminal verification command was recorded."], followUps: run.commands.some(command => command.exitCode && command.exitCode !== 0) ? ["Review the failed command output in the activity log."] : [] };
}

function taskRequestsWorkspaceMutation(task: string) {
  return /\b(create|write|add|implement|edit|modify|delete|remove|build|fix|update)\b/i.test(task);
}

export class CodgramRuntime {
  private readonly sessions = new Map<string, RuntimeSession>();
  constructor(private readonly provider: AgentProvider = defaultProvider) {}

  private async patchRun(id: string, mutator: (run: CodgramRun) => CodgramRun) {
    return localHistory.updateRun(id, run => mutator({ ...run, updatedAt: new Date().toISOString() }));
  }

  private async addActivity(id: string, next: RunActivity) {
    await this.patchRun(id, run => ({ ...run, activities: [...run.activities, next] }));
    await writeLocalLog("agent.activity", { runId: id, level: next.level, title: next.title, detail: next.detail, tool: next.toolName });
  }

  async listModels() { return this.provider.listModels(await localHistory.getSettings()); }

  async start(workspaceId: string, task: string): Promise<CodgramRun> {
    const inspection = await workspaceService.inspect(workspaceId);
    const now = new Date().toISOString();
    const run: CodgramRun = {
      id: randomUUID(), workspaceId, workspaceName: inspection.name, task: task.trim(), status: "planning", createdAt: now, updatedAt: now,
      inspection, plan: null, activities: [activity("info", "Workspace selected", `${inspection.framework} · ${inspection.language}${inspection.packageManager ? ` · ${inspection.packageManager}` : ""}`)], changes: [], rollbackCheckpoint: createRollbackCheckpoint(), commands: [], pendingAction: null, iteration: 0, stopRequested: false, finalReport: null, error: null,
    };
    await localHistory.createRun(run);
    this.sessions.set(run.id, { context: new AgentContextManager(run.task, inspection) });
    await writeLocalLog("agent.started", { runId: run.id, workspaceId, task: run.task });
    void this.begin(run.id);
    return run;
  }

  private async begin(runId: string) {
    let run = await localHistory.getRun(runId);
    if (!run) return;
    const settings = await localHistory.getSettings();
    try {
      await this.addActivity(runId, activity("tool", "Inspecting workspace", "Detected stack and safe project markers."));
      let plan;
      try {
        plan = await this.provider.createPlan(run.task, run.inspection!, settings);
      } catch (error) {
        plan = { summary: `Safely implement: ${run.task}`, steps: [{ id: "inspect", title: "Inspect the project", detail: "Read relevant source and configuration files.", status: "pending" }, { id: "implement", title: "Implement the change", detail: "Make tracked edits inside the workspace.", status: "pending" }, { id: "verify", title: "Verify", detail: "Inspect the diff and run a relevant command.", status: "pending" }] } satisfies AgentPlan;
        await this.addActivity(runId, activity("warning", "Using a resilient fallback plan", "The model plan was unavailable; Codgram will continue with a conservative inspection and verification plan."));
      }
      await this.patchRun(runId, current => ({ ...current, status: "running", startedAt: new Date().toISOString(), plan }));
      this.sessions.get(runId)?.context.setPlan(plan);
      await this.addActivity(runId, activity("success", "Plan created", plan.summary));
      await this.executeLoop(runId, settings);
    } catch (error) {
      await this.fail(runId, error);
    }
  }

  private async executeLoop(runId: string, settings: CodgramSettings) {
    const session = this.sessions.get(runId);
    if (!session) throw new Error("Codgram lost the active agent session. Start a new run to continue safely.");
    while (true) {
      const run = await localHistory.getRun(runId);
      if (!run || run.stopRequested || run.status === "stopped" || run.status === "awaiting_confirmation") return;
      if (run.iteration >= settings.maxIterations) {
        await this.complete(runId, undefined, "Codgram reached the configured iteration limit before declaring a result.");
        return;
      }
      await this.patchRun(runId, current => ({ ...current, iteration: current.iteration + 1 }));
      await this.addActivity(runId, activity("info", "Codgram is reasoning", `Iteration ${(await localHistory.getRun(runId))?.iteration || 1} of ${settings.maxIterations}.`));
      let decision;
      try {
        decision = await this.provider.nextDecision(session.context.messages(), settings);
      } catch (error) {
        await this.fail(runId, error);
        return;
      }
      if (!decision.toolCalls.length) {
        const current = await localHistory.getRun(runId);
        if (current && taskRequestsWorkspaceMutation(current.task) && current.changes.length === 0) {
          const reason = "Codgram cannot complete this mutation task yet because no tracked workspace change has been recorded.";
          await this.addActivity(runId, activity("warning", "Completion deferred", reason));
          session.context.addToolResult("agent", reason);
          continue;
        }
        await this.complete(runId, decision.text || undefined);
        return;
      }
      session.context.addDecision(decision.text || "Codgram chose the following tool action(s).");
      for (const call of decision.toolCalls) {
        const latest = await localHistory.getRun(runId);
        if (!latest || latest.stopRequested) return;
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          await this.addActivity(runId, activity("error", "Tool request rejected", `The model supplied invalid arguments for ${call.function.name}.`, call.function.name));
          session.context.addToolResult(call.function.name, "Codgram rejected the request because its arguments were not valid JSON.");
          continue;
        }
        await this.addActivity(runId, activity("tool", `Running ${call.function.name}`, "Codgram is executing a bounded workspace action.", call.function.name));
        try {
          const result = await executeCodgramTool(latest.workspaceId, call.function.name, args, false, settings.confirmationMode);
          if (result.requiresConfirmation) {
            const pending: PendingAction = { id: randomUUID(), ...result.requiresConfirmation };
            await this.patchRun(runId, current => ({ ...current, status: "awaiting_confirmation", pendingAction: pending }));
            await this.addActivity(runId, activity("warning", "Confirmation required", pending.preview, pending.toolName));
            return;
          }
          await this.recordResult(runId, result);
          session.context.addToolResult(call.function.name, result.content);
          if (result.finish) {
            const current = await localHistory.getRun(runId);
            if (current && taskRequestsWorkspaceMutation(current.task) && current.changes.length === 0) {
              const reason = "Codgram rejected the finish request because this task asks for a workspace change, but no tracked file modification has been recorded yet.";
              await this.addActivity(runId, activity("warning", "Finish request deferred", reason, "finish"));
              session.context.addToolResult("finish", reason);
              continue;
            }
            await this.complete(runId, result.content);
            return;
          }
        } catch (error) {
          const message = error instanceof Error ? redactSecrets(error.message) : "Unknown tool error";
          await this.addActivity(runId, activity("error", `${call.function.name} failed`, message, call.function.name));
          session.context.addToolResult(call.function.name, `Tool error: ${message}`);
        }
      }
    }
  }

  private async recordResult(runId: string, result: Awaited<ReturnType<typeof executeCodgramTool>>) {
    await this.patchRun(runId, run => ({
      ...run,
      changes: result.change ? [...run.changes, result.change] : run.changes,
      rollbackCheckpoint: result.change ? recordRollbackChange(run.rollbackCheckpoint, result.change) : run.rollbackCheckpoint,
      commands: result.command ? [...run.commands, result.command] : run.commands,
    }));
    if (result.change) await this.addActivity(runId, activity("success", `File ${result.change.kind}`, result.change.path, "file_change"));
    if (result.command) await this.addActivity(runId, activity(result.command.exitCode === 0 ? "success" : "error", "Command finished", `${result.command.command} · exit ${result.command.exitCode ?? "stopped"} · ${(result.command.durationMs / 1000).toFixed(1)}s`, "terminal"));
  }

  async confirm(runId: string, approved: boolean): Promise<CodgramRun> {
    const run = await localHistory.getRun(runId);
    if (!run || !run.pendingAction) throw new Error("There is no pending Codgram confirmation for this run.");
    const pending = run.pendingAction;
    if (!approved) {
      const stopped = await this.patchRun(runId, current => ({ ...current, status: "stopped", completedAt: new Date().toISOString(), pendingAction: null, finalReport: fallbackReport(current, "Codgram stopped because a safety confirmation was declined.") }));
      await this.addActivity(runId, activity("warning", "Action declined", pending.preview, pending.toolName));
      return stopped;
    }
    await this.patchRun(runId, current => ({ ...current, status: "running", pendingAction: null }));
    await this.addActivity(runId, activity("success", "Action approved", pending.preview, pending.toolName));
    try {
      const result = await executeCodgramTool(run.workspaceId, pending.toolName, pending.arguments, true);
      await this.recordResult(runId, result);
      const session = this.sessions.get(runId);
      if (!session) throw new Error("Codgram cannot safely resume after a local server restart. Start a new run.");
      session.context.addToolResult(pending.toolName, result.content);
      const settings = await localHistory.getSettings();
      void this.executeLoop(runId, settings);
    } catch (error) {
      await this.fail(runId, error);
    }
    return (await localHistory.getRun(runId))!;
  }

  async stop(runId: string): Promise<CodgramRun> {
    const run = await this.patchRun(runId, current => ({ ...current, stopRequested: true, status: "stopped", completedAt: new Date().toISOString(), pendingAction: null, finalReport: fallbackReport(current, "Codgram was stopped by the user. No further actions will run.") }));
    await this.addActivity(runId, activity("warning", "Codgram stopped", "The current run will not make another tool request."));
    return run;
  }

  async rollback(runId: string): Promise<CodgramRun> {
    const run = await localHistory.getRun(runId);
    if (!run) throw new Error("Codgram run was not found.");
    if (!["completed", "failed", "stopped"].includes(run.status)) throw new Error("Codgram only restores checkpoints after a run has stopped.");
    if (run.rollbackCheckpoint.status !== "ready") throw new Error("This run checkpoint has already been restored.");
    const restored = await workspaceService.restoreCheckpoint(run.workspaceId, run.rollbackCheckpoint.entries);
    const summary = `Restored ${restored.length} tracked file change${restored.length === 1 ? "" : "s"} to the state before this run.`;
    await this.patchRun(runId, current => ({ ...current, rollbackCheckpoint: { ...current.rollbackCheckpoint, status: "restored", restoredAt: new Date().toISOString(), restoreSummary: summary } }));
    await this.addActivity(runId, activity("success", "Checkpoint restored", summary, "rollback"));
    await writeLocalLog("agent.rollback", { runId, workspaceId: run.workspaceId, restoredFiles: restored.map(change => change.path) });
    return (await localHistory.getRun(runId))!;
  }

  private async complete(runId: string, finishSummary?: string, limitNote?: string) {
    const run = await localHistory.getRun(runId);
    if (!run) return;
    let report: CompletionReport;
    const settings = await localHistory.getSettings();
    try {
      report = await this.provider.createReport({ task: run.task, plan: run.plan, commands: run.commands.map(command => `${command.command}: ${command.exitCode}`), changes: run.changes.map(change => `${change.kind}: ${change.path}`), finishSummary: limitNote || finishSummary }, settings);
    } catch {
      report = fallbackReport(run, limitNote || finishSummary);
    }
    await this.patchRun(runId, current => ({ ...current, status: "completed", completedAt: new Date().toISOString(), finalReport: report, pendingAction: null }));
    await this.addActivity(runId, activity("success", "Run completed", report.summary));
    this.sessions.delete(runId);
  }

  private async fail(runId: string, error: unknown) {
    const message = error instanceof Error ? redactSecrets(error.message) : "Unknown agent runtime error";
    await this.patchRun(runId, current => ({ ...current, status: "failed", completedAt: new Date().toISOString(), error: message, finalReport: fallbackReport(current, `Codgram stopped after an error: ${message}`) }));
    await this.addActivity(runId, activity("error", "Run stopped after an error", message));
    this.sessions.delete(runId);
  }
}

export const codgramRuntime = new CodgramRuntime();
