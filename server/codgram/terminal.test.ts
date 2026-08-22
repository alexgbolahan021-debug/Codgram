import { describe, expect, it } from "vitest";
import { assessCommand } from "./terminal";

describe("Codgram command validation", () => {
  it("permits a single relevant package-manager verification command", () => {
    expect(assessCommand("pnpm test")).toMatchObject({ approved: true, requiresConfirmation: false, args: ["pnpm", "test"] });
    expect(assessCommand("npm run build")).toMatchObject({ approved: true, requiresConfirmation: false });
  });

  it("requires confirmation for dependency changes", () => {
    expect(assessCommand("pnpm add zod")).toMatchObject({ approved: true, requiresConfirmation: true });
  });

  it("blocks shell chaining, arbitrary executables, and development servers", () => {
    expect(assessCommand("npm test && rm -rf .").approved).toBe(false);
    expect(assessCommand("rm -rf .").approved).toBe(false);
    expect(assessCommand("npm run dev").approved).toBe(false);
  });
});
