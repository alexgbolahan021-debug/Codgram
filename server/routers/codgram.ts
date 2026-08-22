import { z } from "zod";
import { localHistory } from "../codgram/history";
import { codgramRuntime } from "../codgram/runtime";
import { DEFAULT_SETTINGS } from "../codgram/types";
import { workspaceService } from "../codgram/workspace";
import { protectedProcedure, router } from "../_core/trpc";

const workspaceInput = z.object({ workspaceId: z.string().min(1).max(180) });

export const codgramRouter = router({
  workspaces: protectedProcedure.query(() => workspaceService.listWorkspaces()),
  inspectWorkspace: protectedProcedure.input(workspaceInput).query(({ input }) => workspaceService.inspect(input.workspaceId)),
  listModels: protectedProcedure.query(async () => {
    try {
      return { models: await codgramRuntime.listModels(), available: true };
    } catch {
      return { models: [], available: false };
    }
  }),
  getSettings: protectedProcedure.query(() => localHistory.getSettings()),
  saveSettings: protectedProcedure.input(z.object({ provider: z.enum(["manus-built-in", "openai-compatible"]), model: z.string().min(1).max(160), maxIterations: z.number().int().min(1).max(30), confirmationMode: z.enum(["dangerous-only", "all-writes"]), theme: z.enum(["dark", "system"]) })).mutation(({ input }) => localHistory.saveSettings({ ...DEFAULT_SETTINGS, ...input })),
  listRuns: protectedProcedure.query(() => localHistory.listRuns()),
  getRun: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const run = await localHistory.getRun(input.id);
    if (!run) throw new Error("Codgram run was not found.");
    return run;
  }),
  startRun: protectedProcedure.input(z.object({ workspaceId: z.string().min(1).max(180), task: z.string().trim().min(8).max(10_000) })).mutation(({ input }) => codgramRuntime.start(input.workspaceId, input.task)),
  confirmAction: protectedProcedure.input(z.object({ runId: z.string().uuid(), approved: z.boolean() })).mutation(({ input }) => codgramRuntime.confirm(input.runId, input.approved)),
  stopRun: protectedProcedure.input(z.object({ runId: z.string().uuid() })).mutation(({ input }) => codgramRuntime.stop(input.runId)),
});
