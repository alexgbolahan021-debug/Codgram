const fs = require("node:fs/promises");
const path = require("node:path");

function createProviderSecretStore({ app, safeStorage, platform = process.platform }) {
  const filePath = () => path.join(app.getPath("userData"), "codgram", "provider-secret.json");

  async function capability() {
    const encryptionAvailable = typeof safeStorage.isAsyncEncryptionAvailable === "function"
      ? await safeStorage.isAsyncEncryptionAvailable()
      : safeStorage.isEncryptionAvailable();
    if (!encryptionAvailable) return { available: false, backend: null, message: "Operating-system protected storage is unavailable on this device." };
    const backend = platform === "linux" && typeof safeStorage.getSelectedStorageBackend === "function" ? safeStorage.getSelectedStorageBackend() : null;
    if (backend === "basic_text") return { available: false, backend, message: "Codgram will not store a provider secret because this Linux session has no protected secret service." };
    const label = platform === "darwin" ? "macOS Keychain" : platform === "win32" ? "Windows DPAPI" : backend ? backend.replaceAll("_", " ") : "desktop secret service";
    return { available: true, backend: label, message: `Protected by ${label}.` };
  }

  async function getStatus() {
    const status = await capability();
    if (!status.available) return { ...status, stored: false };
    try {
      await fs.access(filePath());
      return { ...status, stored: true };
    } catch (error) {
      if (error?.code === "ENOENT") return { ...status, stored: false };
      throw new Error("Codgram could not inspect protected provider-secret storage.");
    }
  }

  async function save(secret) {
    if (typeof secret !== "string" || !secret.trim() || secret.length > 10_000) throw new Error("Enter a valid provider secret.");
    const status = await capability();
    if (!status.available) throw new Error(status.message);
    const encrypted = await safeStorage.encryptStringAsync(secret.trim());
    const target = filePath();
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const next = `${target}.next`;
    await fs.writeFile(next, JSON.stringify({ version: 1, ciphertext: encrypted.toString("base64") }), { mode: 0o600 });
    await fs.rename(next, target);
    return { ...status, stored: true };
  }

  async function read() {
    const status = await getStatus();
    if (!status.available || !status.stored) return null;
    try {
      const raw = await fs.readFile(filePath(), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || typeof parsed.ciphertext !== "string") throw new Error("invalid");
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(parsed.ciphertext, "base64"));
      return decrypted.result;
    } catch {
      throw new Error("Codgram could not read the protected provider secret. Clear it and store it again.");
    }
  }

  async function clear() {
    try {
      await fs.rm(filePath());
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error("Codgram could not clear protected provider-secret storage.");
    }
    return getStatus();
  }

  return { getStatus, save, read, clear };
}

module.exports = { createProviderSecretStore };
