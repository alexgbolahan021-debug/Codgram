import { describe, expect, it } from "vitest";
import { AgentContextManager } from "./context";
import type { WorkspaceInspection } from "./types";

const inspection: WorkspaceInspection = { id: "demo", name: "demo", relativePath: "demo", framework: "Vite", language: "TypeScript", packageManager: "pnpm", hasGit: true, gitSummary: "ready", files: Array.from({ length: 90 }, (_, index) => `file-${index}.ts`), stackSignals: ["Vite"] };

describe("Codgram context manager", () => {
  it("selectively carries bounded inspection, current plan, recent observations, and redacts secrets", () => {
    const context = new AgentContextManager("Update the test project", inspection);
    context.setPlan({ summary: "Make a safe change", steps: [{ id: "1", title: "Inspect", detail: "Read source", status: "pending" }] });
    context.addToolResult("read_file", "API_KEY=not-visible\nexport const app = true;");
    for (let index = 0; index < 20; index++) context.addDecision(`Decision ${index}`);
    const messages = context.messages();
    const text = messages.map(message => String(message.content)).join("\n");
    expect(text).toContain("Current approved plan");
    expect(text).toContain("Decision 19");
    expect(text).not.toContain("Decision 0");
    expect(text).not.toContain("not-visible");
    expect(text).not.toContain("file-89.ts");
  });
});
