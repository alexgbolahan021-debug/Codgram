import { describe, expect, it } from "vitest";
import { getWorkspaceRoot } from "./security";

const savedWorkspaceVariables = {
  codgram: process.env.CODGRAM_WORKSPACE_ROOT,
  cortex: process.env.CORTEX_WORKSPACE_ROOT,
};

function restore(key: "CODGRAM_WORKSPACE_ROOT" | "CORTEX_WORKSPACE_ROOT", value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("Codgram managed identity", () => {
  it("uses the official Codgram application title", () => {
    expect(process.env.VITE_APP_TITLE).toBe("Codgram");
  });

  it("prefers the Codgram workspace variable and retains the legacy variable only as a fallback", () => {
    delete process.env.CODGRAM_WORKSPACE_ROOT;
    process.env.CORTEX_WORKSPACE_ROOT = "/tmp/codgram-legacy-fallback";
    expect(getWorkspaceRoot()).toBe("/tmp/codgram-legacy-fallback");
    process.env.CODGRAM_WORKSPACE_ROOT = "/tmp/codgram-primary";
    expect(getWorkspaceRoot()).toBe("/tmp/codgram-primary");
    restore("CODGRAM_WORKSPACE_ROOT", savedWorkspaceVariables.codgram);
    restore("CORTEX_WORKSPACE_ROOT", savedWorkspaceVariables.cortex);
  });
});
