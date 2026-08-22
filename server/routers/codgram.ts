import { z } from "zod";
import { localHistory } from "../codgram/history";
import { codgramRuntime } from "../codgram/runtime";
import { DEFAULT_SETTINGS } from "../codgram/types";
import { workspaceService } from "../codgram/workspace";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";

const workspaceInput = z.object({ workspaceId: z.string().min(1).max(180) });
const smokeMode = process.env.CODGRAM_DESKTOP_V21_UI_SMOKE;
const codgramProcedure = smokeMode === "success" || smokeMode === "conflict" ? publicProcedure : protectedProcedure;

export const codgramRouter = router({
  workspaces: codgramProcedure.query(() => workspaceService.listWorkspaces()),
  inspectWorkspace: codgramProcedure.input(workspaceInput).query(({ input }) => workspaceService.inspect(input.workspaceId)),
  listModels: codgramProcedure.query(async () => {
    if (smokeMode === "success" || smokeMode === "conflict") return { models: ["smoke-coder"], available: true };
    try {
      return { models: await codgramRuntime.listModels(), available: true };
    } catch {
      return { models: [], available: false };
    }
  }),
  getSettings: codgramProcedure.query(() => localHistory.getSettings()),
  saveSettings: codgramProcedure.input(z.object({ provider: z.enum(["manus-built-in", "openai-compatible"]), model: z.string().min(1).max(160), maxIterations: z.number().int().min(1).max(30), confirmationMode: z.enum(["dangerous-only", "all-writes"]), theme: z.enum(["dark", "system"]), onboardingCompleted: z.boolean() })).mutation(({ input }) => localHistory.saveSettings({ ...DEFAULT_SETTINGS, ...input })),
  listRuns: codgramProcedure.query(() => localHistory.listRuns()),
  getRun: codgramProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    const run = await localHistory.getRun(input.id);
    if (!run) throw new Error("Codgram run was not found.");
    return run;
  }),
  startRun: codgramProcedure.input(z.object({ workspaceId: z.string().min(1).max(180), task: z.string().trim().min(8).max(10_000) })).mutation(({ input }) => codgramRuntime.start(input.workspaceId, input.task)),
  confirmAction: codgramProcedure.input(z.object({ runId: z.string().uuid(), approved: z.boolean() })).mutation(({ input }) => codgramRuntime.confirm(input.runId, input.approved)),
  stopRun: codgramProcedure.input(z.object({ runId: z.string().uuid() })).mutation(({ input }) => codgramRuntime.stop(input.runId)),
  rollbackRun: codgramProcedure.input(z.object({ runId: z.string().uuid(), confirmed: z.literal(true) })).mutation(({ input }) => codgramRuntime.rollback(input.runId)),
});
