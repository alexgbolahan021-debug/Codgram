import { afterEach, describe, expect, it } from "vitest";
import { ConfigurableProvider } from "./provider";
import { DEFAULT_SETTINGS } from "./types";

const saved = {
  baseUrl: process.env.CODGRAM_OPENAI_BASE_URL,
  apiKey: process.env.CODGRAM_OPENAI_API_KEY,
  model: process.env.CODGRAM_OPENAI_MODEL,
};

afterEach(() => {
  process.env.CODGRAM_OPENAI_BASE_URL = saved.baseUrl;
  process.env.CODGRAM_OPENAI_API_KEY = saved.apiKey;
  process.env.CODGRAM_OPENAI_MODEL = saved.model;
});

describe("Codgram provider configuration", () => {
  it("rejects an unconfigured OpenAI-compatible provider without including secret material", async () => {
    delete process.env.CODGRAM_OPENAI_BASE_URL;
    delete process.env.CODGRAM_OPENAI_API_KEY;
    delete process.env.CODGRAM_OPENAI_MODEL;
    const provider = new ConfigurableProvider();
    await expect(provider.listModels({ ...DEFAULT_SETTINGS, provider: "openai-compatible" })).rejects.toThrow(/not configured on the local server/i);
  });
});
