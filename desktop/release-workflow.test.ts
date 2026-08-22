import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = path.resolve(import.meta.dirname, "..", ".github", "workflows", "release.yml");
const workflow = readFileSync(workflowPath, "utf8");

describe("Codgram signed release workflow", () => {
  it("uses native release jobs, required signing secrets, draft publishing, and explicit code-signing enforcement", () => {
    expect(workflow).toContain("tags:");
    expect(workflow).toContain('"v*.*.*"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("runs-on: macos-latest");
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).toContain("MAC_CSC_LINK");
    expect(workflow).toContain("APPLE_APP_SPECIFIC_PASSWORD");
    expect(workflow).toContain("WIN_CSC_LINK");
    expect(workflow).toContain("-c.forceCodeSigning=true");
    expect(workflow).toContain("--publish never");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("--draft");
  });
});
