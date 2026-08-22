import path from "node:path";
import { describe, expect, it } from "vitest";
import { redactSecrets, resolveInside } from "./security";

describe("Codgram workspace security", () => {
  it("keeps resolved paths inside the selected workspace", () => {
    const root = path.resolve("/tmp/codgram-workspace");
    expect(resolveInside(root, "src/app.ts")).toBe(path.join(root, "src/app.ts"));
    expect(() => resolveInside(root, "../outside.txt")).toThrow(/leave the selected workspace/i);
    expect(() => resolveInside(root, "/etc/passwd")).toThrow(/absolute paths/i);
  });

  it("redacts secret-shaped values before activity or log output", () => {
    const value = "API_KEY=abc123 Authorization: Bearer a.b.c password: hunter2";
    const redacted = redactSecrets(value);
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("a.b.c");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).toContain("[REDACTED]");
  });
});
