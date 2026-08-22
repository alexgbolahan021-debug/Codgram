import type { AgentPlan, WorkspaceInspection } from "./types";
import type { Message } from "../_core/llm";
import { redactSecrets } from "./security";

const MAX_CONTEXT_ENTRIES = 12;
const MAX_CONTEXT_CHARACTERS = 18_000;
const MAX_TOOL_RESULT_CHARACTERS = 4_000;

function clip(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n[Context truncated by Codgram]`;
}

/**
 * Selective in-memory context for one active run. It carries the task, bounded
 * stack inspection, current plan, and only recent redacted tool observations;
 * it never serializes an entire repository or persistent secrets to the model.
 */
export class AgentContextManager {
  private readonly seed: Message;
  private plan: AgentPlan | null = null;
  private entries: Message[] = [];

  constructor(task: string, inspection: WorkspaceInspection) {
    this.seed = {
      role: "user",
      content: JSON.stringify({
        task,
        workspace: {
          name: inspection.name,
          framework: inspection.framework,
          language: inspection.language,
          packageManager: inspection.packageManager,
          hasGit: inspection.hasGit,
          stackSignals: inspection.stackSignals,
          topLevelFiles: inspection.files.slice(0, 50),
        },
      }),
    };
  }

  setPlan(plan: AgentPlan) {
    this.plan = plan;
  }

  addDecision(text: string) {
    if (text.trim()) this.entries.push({ role: "assistant", content: clip(redactSecrets(text), 2_000) });
  }

  addToolResult(toolName: string, result: string) {
    // Tool output is recorded as a compact user-side observation rather than
    // a protocol-coupled tool message, keeping the provider abstraction portable.
    this.entries.push({ role: "user", content: `Tool result from ${toolName}:\n${clip(redactSecrets(result), MAX_TOOL_RESULT_CHARACTERS)}` });
  }

  messages(): Message[] {
    const planMessage: Message | null = this.plan ? { role: "user", content: `Current approved plan:\n${JSON.stringify(this.plan)}` } : null;
    const recent = this.entries.slice(-MAX_CONTEXT_ENTRIES);
    const selected = [this.seed, ...(planMessage ? [planMessage] : []), ...recent];
    const result: Message[] = [];
    let size = 0;
    for (const message of selected.reverse()) {
      const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
      if (size + content.length > MAX_CONTEXT_CHARACTERS && result.length > 0) continue;
      result.unshift({ ...message, content: content });
      size += content.length;
    }
    return result;
  }
}
