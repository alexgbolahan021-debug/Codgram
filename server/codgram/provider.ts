import { invokeLLM, listLLMModels, type FileContent, type ImageContent, type InvokeParams, type InvokeResult, type Message, type TextContent, type ToolCall } from "../_core/llm";
import { CODGRAM_TOOLS } from "./tool-registry";
import type { AgentPlan, CompletionReport, CodgramSettings, WorkspaceInspection } from "./types";

const SYSTEM_PROMPT = `You are Codgram, a careful personal coding agent. Work only through provided tools in the selected workspace. Inspect before editing. Never ask to access secrets, .env files, unrelated paths, the network, remote deployment, or git push. Prefer small, reviewable changes. Run relevant build, test, lint, or typecheck commands before finish. Stop and use finish only after inspecting final changes. Use tools rather than assuming project details.`;

type Decision = { text: string; toolCalls: ToolCall[] };

export interface AgentProvider {
  listModels(settings: CodgramSettings): Promise<string[]>;
  createPlan(task: string, inspection: WorkspaceInspection, settings: CodgramSettings): Promise<AgentPlan>;
  nextDecision(messages: Message[], settings: CodgramSettings): Promise<Decision>;
  createReport(input: { task: string; plan: AgentPlan | null; commands: string[]; changes: string[]; finishSummary?: string }, settings: CodgramSettings): Promise<CompletionReport>;
}

function responseText(value: string | Array<TextContent | ImageContent | FileContent> | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.filter((part): part is TextContent => part.type === "text").map(part => part.text).join("\n");
}

function selectedModel(settings: CodgramSettings): string | undefined {
  return settings.model === "default" ? undefined : settings.model;
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`The AI provider returned an invalid ${label} response.`);
  }
}

function fallbackPlan(task: string, inspection: WorkspaceInspection): AgentPlan {
  return {
    summary: `Inspect and implement: ${task}`,
    steps: [
      { id: "inspect", title: "Inspect the project", detail: `Review ${inspection.framework}, relevant source files, and package scripts before editing.`, status: "pending" },
      { id: "implement", title: "Implement the scoped change", detail: "Apply small, tracked edits only inside the selected workspace.", status: "pending" },
      { id: "verify", title: "Verify the result", detail: "Inspect the diff and run an applicable build, test, lint, or typecheck command.", status: "pending" },
    ],
  };
}

export class ManusBuiltInProvider implements AgentProvider {
  async listModels(_settings: CodgramSettings): Promise<string[]> {
    const result = await listLLMModels();
    return result.data.map(model => model.id).sort();
  }

  protected resolveModel(settings: CodgramSettings): string | undefined {
    return selectedModel(settings);
  }

  protected invoke(params: InvokeParams): Promise<InvokeResult> {
    return invokeLLM(params);
  }

  async createPlan(task: string, inspection: WorkspaceInspection, settings: CodgramSettings): Promise<AgentPlan> {
    const response = await this.invoke({
      model: this.resolveModel(settings),
      messages: [
        { role: "system", content: `${SYSTEM_PROMPT} Return only a concise implementation plan with 3–7 steps.` },
        { role: "user", content: JSON.stringify({ task, workspace: inspection }) },
      ],
      outputSchema: {
        name: "codgram_plan",
        strict: true,
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            steps: {
              type: "array",
              minItems: 3,
              maxItems: 7,
              items: {
                type: "object",
                properties: { title: { type: "string" }, detail: { type: "string" } },
                required: ["title", "detail"],
                additionalProperties: false,
              },
            },
          },
          required: ["summary", "steps"],
          additionalProperties: false,
        },
      },
      max_tokens: 1600,
    });
    const parsed = parseJson<{ summary: string; steps: Array<{ title: string; detail: string }> }>(responseText(response.choices[0]?.message.content || ""), "plan");
    if (!parsed.summary || !Array.isArray(parsed.steps) || parsed.steps.length === 0) return fallbackPlan(task, inspection);
    return { summary: parsed.summary, steps: parsed.steps.map((step, index) => ({ id: `step-${index + 1}`, title: step.title, detail: step.detail, status: "pending" })) };
  }

  async nextDecision(messages: Message[], settings: CodgramSettings): Promise<Decision> {
    const response = await this.invoke({ model: this.resolveModel(settings), messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages], tools: CODGRAM_TOOLS, toolChoice: "auto", max_tokens: 3200 });
    const message = response.choices[0]?.message;
    if (!message) throw new Error("The AI provider returned no decision.");
    return { text: responseText(message.content), toolCalls: message.tool_calls || [] };
  }

  async createReport(input: { task: string; plan: AgentPlan | null; commands: string[]; changes: string[]; finishSummary?: string }, settings: CodgramSettings): Promise<CompletionReport> {
    const response = await this.invoke({
      model: this.resolveModel(settings),
      messages: [
        { role: "system", content: "You are Codgram. Return a concise, factual completion report. Do not claim verification that is not present in the supplied results." },
        { role: "user", content: JSON.stringify(input) },
      ],
      outputSchema: {
        name: "codgram_completion_report",
        strict: true,
        schema: {
          type: "object",
          properties: { summary: { type: "string" }, verification: { type: "array", items: { type: "string" } }, followUps: { type: "array", items: { type: "string" } } },
          required: ["summary", "verification", "followUps"],
          additionalProperties: false,
        },
      },
      max_tokens: 1300,
    });
    const parsed = parseJson<CompletionReport>(responseText(response.choices[0]?.message.content || ""), "completion report");
    return { summary: parsed.summary, verification: parsed.verification.slice(0, 6), followUps: parsed.followUps.slice(0, 4) };
  }
}

class OpenAICompatibleProvider extends ManusBuiltInProvider {
  private config() {
    const baseUrl = (process.env.CODGRAM_OPENAI_BASE_URL || process.env.CORTEX_OPENAI_BASE_URL)?.replace(/\/$/, "");
    const apiKey = process.env.CODGRAM_OPENAI_API_KEY || process.env.CORTEX_OPENAI_API_KEY;
    const defaultModel = process.env.CODGRAM_OPENAI_MODEL || process.env.CORTEX_OPENAI_MODEL;
    if (!baseUrl || !apiKey || !defaultModel) {
      throw new Error("The OpenAI-compatible provider is not configured on the local server. Set CODGRAM_OPENAI_BASE_URL, CODGRAM_OPENAI_API_KEY, and CODGRAM_OPENAI_MODEL before selecting it.");
    }
    return { baseUrl, apiKey, defaultModel };
  }

  protected override resolveModel(settings: CodgramSettings): string | undefined {
    return settings.model === "default" ? this.config().defaultModel : settings.model;
  }

  override async listModels(_settings: CodgramSettings): Promise<string[]> {
    const config = this.config();
    const response = await fetch(`${config.baseUrl}/models`, { headers: { authorization: `Bearer ${config.apiKey}` } });
    if (!response.ok) throw new Error("The OpenAI-compatible model catalog could not be reached. Check the local server configuration.");
    const parsed = await response.json() as { data?: Array<{ id?: string }> };
    return (parsed.data || []).map(model => model.id).filter((id): id is string => Boolean(id)).sort();
  }

  protected override async invoke(params: InvokeParams): Promise<InvokeResult> {
    const config = this.config();
    const schema = params.outputSchema || params.output_schema;
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ messages: params.messages, model: params.model || config.defaultModel, tools: params.tools, tool_choice: params.toolChoice || params.tool_choice, max_tokens: params.max_tokens || params.maxTokens, response_format: schema ? { type: "json_schema", json_schema: schema } : params.responseFormat || params.response_format }),
    });
    if (!response.ok) throw new Error("The OpenAI-compatible provider could not complete this request. Check its local configuration or availability.");
    return await response.json() as InvokeResult;
  }
}

export class ConfigurableProvider implements AgentProvider {
  private readonly manus = new ManusBuiltInProvider();
  private readonly openai = new OpenAICompatibleProvider();

  private active(settings: CodgramSettings): AgentProvider {
    return settings.provider === "openai-compatible" ? this.openai : this.manus;
  }

  listModels(settings: CodgramSettings) { return this.active(settings).listModels(settings); }
  createPlan(task: string, inspection: WorkspaceInspection, settings: CodgramSettings) { return this.active(settings).createPlan(task, inspection, settings); }
  nextDecision(messages: Message[], settings: CodgramSettings) { return this.active(settings).nextDecision(messages, settings); }
  createReport(input: { task: string; plan: AgentPlan | null; commands: string[]; changes: string[]; finishSummary?: string }, settings: CodgramSettings) { return this.active(settings).createReport(input, settings); }
}

export const defaultProvider = new ConfigurableProvider();
