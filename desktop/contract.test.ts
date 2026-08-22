import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { toWorkspaceSelection } = require("./contract.cjs") as { toWorkspaceSelection(value: string): { workspaceId: string; workspaceRoot: string } };

describe("Codgram desktop workspace selection", () => {
  it("hands a directly selected project folder to the server as a bounded parent root and workspace id", () => {
    expect(toWorkspaceSelection("/Users/codgram/Projects/website")).toEqual({ workspaceRoot: "/Users/codgram/Projects", workspaceId: "website" });
  });

  it("rejects a filesystem root or relative path", () => {
    expect(() => toWorkspaceSelection("relative-project")).toThrow(/absolute/i);
    expect(() => toWorkspaceSelection("/")).toThrow(/project folder/i);
  });
});
