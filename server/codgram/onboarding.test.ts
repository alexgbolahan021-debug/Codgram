import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localHistory } from "./history";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codgram-onboarding-"));
const previousDataDir = process.env.CODGRAM_DATA_DIR;

describe("Codgram provider onboarding", () => {
  beforeAll(() => { process.env.CODGRAM_DATA_DIR = dataDir; });
  afterAll(async () => {
    if (previousDataDir === undefined) delete process.env.CODGRAM_DATA_DIR;
    else process.env.CODGRAM_DATA_DIR = previousDataDir;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("persists a completed provider choice locally without any credential fields", async () => {
    const initial = await localHistory.getSettings();
    expect(initial.onboardingCompleted).toBe(false);
    const saved = await localHistory.saveSettings({ ...initial, provider: "openai-compatible", model: "local-coder", onboardingCompleted: true });

    expect(saved).toEqual(expect.objectContaining({ provider: "openai-compatible", model: "local-coder", onboardingCompleted: true }));
    await expect(fs.readFile(path.join(dataDir, "settings.json"), "utf8")).resolves.not.toMatch(/api[_-]?key/i);
  });
});
