import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { createProviderSecretStore } = require("./provider-secret-store.cjs") as typeof import("./provider-secret-store.cjs");

describe("Codgram protected provider-secret storage", () => {
  const cleanup: string[] = [];
  afterEach(async () => { await Promise.all(cleanup.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });

  it("stores encrypted bytes outside settings and exposes only availability state", async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), "codgram-secret-store-"));
    cleanup.push(userData);
    const safeStorage = {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (value: string) => Buffer.from(`sealed:${value}`, "utf8"),
      decryptStringAsync: async (value: Buffer) => ({ result: value.toString("utf8").replace("sealed:", "") }),
    };
    const store = createProviderSecretStore({ app: { getPath: () => userData }, safeStorage, platform: "darwin" });
    expect(await store.getStatus()).toMatchObject({ available: true, stored: false, backend: "macOS Keychain" });
    await store.save("private-provider-value");
    expect(await store.getStatus()).toMatchObject({ available: true, stored: true });
    const raw = await fs.readFile(path.join(userData, "codgram", "provider-secret.json"), "utf8");
    expect(raw).not.toContain("private-provider-value");
    expect(await store.read()).toBe("private-provider-value");
    expect(await store.clear()).toMatchObject({ available: true, stored: false });
  });

  it("refuses Linux basic_text fallback rather than writing an unprotected secret", async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), "codgram-secret-store-"));
    cleanup.push(userData);
    const store = createProviderSecretStore({ app: { getPath: () => userData }, safeStorage: { isAsyncEncryptionAvailable: async () => true, getSelectedStorageBackend: () => "basic_text" }, platform: "linux" });
    await expect(store.save("private-provider-value")).rejects.toThrow("will not store");
    expect(await store.getStatus()).toMatchObject({ available: false, stored: false, backend: "basic_text" });
  });
});
