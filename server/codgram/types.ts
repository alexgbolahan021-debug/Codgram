export type AgentStatus =
  | "idle"
  | "planning"
  | "running"
  | "awaiting_confirmation"
  | "stopped"
  | "completed"
  | "failed";

export type ActivityLevel = "info" | "success" | "warning" | "error" | "tool";

export type AgentPlanStep = {
  id: string;
  title: string;
  detail: string;
  status: "pending" | "active" | "done" | "blocked";
};

export type AgentPlan = {
  summary: string;
  steps: AgentPlanStep[];
};

export type RunActivity = {
  id: string;
  at: string;
  level: ActivityLevel;
  title: string;
  detail: string;
  toolName?: string;
};

export type FileChange = {
  id: string;
  path: string;
  kind: "created" | "edited" | "deleted";
  before: string | null;
  after: string | null;
  diff: string;
  at: string;
};

export type CommandResult = {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  at: string;
};

export type WorkspaceInspection = {
  id: string;
  name: string;
  relativePath: string;
  framework: string;
  language: string;
  packageManager: string | null;
  hasGit: boolean;
  gitSummary: string;
  files: string[];
  stackSignals: string[];
};

export type PendingAction = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  reason: string;
  preview: string;
};

export type CompletionReport = {
  summary: string;
  verification: string[];
  followUps: string[];
};

export type CodgramRun = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  task: string;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  plan: AgentPlan | null;
  inspection: WorkspaceInspection | null;
  activities: RunActivity[];
  changes: FileChange[];
  commands: CommandResult[];
  pendingAction: PendingAction | null;
  iteration: number;
  stopRequested: boolean;
  finalReport: CompletionReport | null;
  error: string | null;
};

export type CodgramSettings = {
  provider: "manus-built-in" | "openai-compatible";
  model: string;
  maxIterations: number;
  confirmationMode: "dangerous-only" | "all-writes";
  theme: "dark" | "system";
};

export type ToolExecutionResult = {
  content: string;
  command?: CommandResult;
  change?: FileChange;
  requiresConfirmation?: Omit<PendingAction, "id">;
  finish?: boolean;
};

export const DEFAULT_SETTINGS: CodgramSettings = {
  provider: "manus-built-in",
  model: "default",
  maxIterations: 12,
  confirmationMode: "dangerous-only",
  theme: "dark",
};
