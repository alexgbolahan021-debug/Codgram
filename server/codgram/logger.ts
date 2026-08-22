import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { redactUnknown } from "./security";

function logDirectory(): string {
  return path.resolve(process.env.CODGRAM_DATA_DIR || process.env.CORTEX_DATA_DIR || path.join(os.homedir(), ".codgram"), "logs");
}

export async function writeLocalLog(event: string, fields: Record<string, unknown>) {
  try {
    const dir = logDirectory();
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const line = JSON.stringify({ at: new Date().toISOString(), event, fields: JSON.parse(redactUnknown(fields)) });
    await fs.appendFile(path.join(dir, "codgram.ndjson"), `${line}\n`, { mode: 0o600 });
  } catch {
    // Logging must never interrupt a coding run.
  }
}
