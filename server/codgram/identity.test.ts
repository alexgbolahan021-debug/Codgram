import { describe, expect, it } from "vitest";
import { getLockedWorkspaceId, getWorkspaceRoot } from "./security";

const savedWorkspaceVariables = {
  codgram: process.env.CODGRAM_WORKSPACE_ROOT,
  cortex: process.env.CORTEX_WORKSPACE_ROOT,
  locked: process.env.CODGRAM_WORKSPACE_ID,
};

function restore(key: "CODGRAM_WORKSPACE_ROOT" | "CORTEX_WORKSPACE_ROOT", value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function restoreLockedWorkspace(value: string | undefined) {
  if (value === undefined) delete process.env.CODGRAM_WORKSPACE_ID;
  else process.env.CODGRAM_WORKSPACE_ID = value;
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

  it("reads a desktop-selected workspace identifier as a normalized lock", () => {
    process.env.CODGRAM_WORKSPACE_ID = "selected-project";
    expect(getLockedWorkspaceId()).toBe("selected-project");
    restoreLockedWorkspace(savedWorkspaceVariables.locked);
  });
});
