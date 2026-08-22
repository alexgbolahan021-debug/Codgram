import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SETTINGS, type CodgramRun, type CodgramSettings } from "./types";

type HistoryDocument = { runs: CodgramRun[] };

function codgramDataDir(): string {
  return path.resolve(process.env.CODGRAM_DATA_DIR || process.env.CORTEX_DATA_DIR || path.join(os.homedir(), ".codgram"));
}

export class LocalHistoryStore {
  private get dataDir() { return codgramDataDir(); }
  private get runsPath() { return path.join(this.dataDir, "runs.json"); }
  private get settingsPath() { return path.join(this.dataDir, "settings.json"); }
  private writeQueue = Promise.resolve();

  private async ensureDirectory() {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
  }

  private async readRuns(): Promise<HistoryDocument> {
    await this.ensureDirectory();
    try {
      const raw = await fs.readFile(this.runsPath, "utf8");
      const parsed = JSON.parse(raw) as HistoryDocument;
      return Array.isArray(parsed.runs) ? parsed : { runs: [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { runs: [] };
      throw new Error("Codgram could not read its local run history.");
    }
  }

  private enqueueWrite(operation: () => Promise<void>) {
    this.writeQueue = this.writeQueue.then(operation, operation);
    return this.writeQueue;
  }

  private async writeRuns(document: HistoryDocument) {
    await this.ensureDirectory();
    const nextPath = `${this.runsPath}.next`;
    await fs.writeFile(nextPath, JSON.stringify(document, null, 2), { mode: 0o600 });
    await fs.rename(nextPath, this.runsPath);
  }

  async listRuns(): Promise<CodgramRun[]> {
    const document = await this.readRuns();
    return document.runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getRun(id: string): Promise<CodgramRun | null> {
    const document = await this.readRuns();
    return document.runs.find(run => run.id === id) || null;
  }

  async createRun(run: CodgramRun): Promise<CodgramRun> {
    await this.enqueueWrite(async () => {
      const document = await this.readRuns();
      document.runs.unshift(run);
      await this.writeRuns(document);
    });
    return run;
  }

  async updateRun(id: string, update: (run: CodgramRun) => CodgramRun): Promise<CodgramRun> {
    let nextRun: CodgramRun | null = null;
    await this.enqueueWrite(async () => {
      const document = await this.readRuns();
      const index = document.runs.findIndex(run => run.id === id);
      if (index < 0) throw new Error("Codgram run was not found.");
      nextRun = update(document.runs[index]);
      document.runs[index] = nextRun;
      await this.writeRuns(document);
    });
    if (!nextRun) throw new Error("Codgram run update did not produce a record.");
    return nextRun;
  }

  async getSettings(): Promise<CodgramSettings> {
    await this.ensureDirectory();
    try {
      const raw = await fs.readFile(this.settingsPath, "utf8");
      const value = JSON.parse(raw) as Partial<CodgramSettings>;
      return { ...DEFAULT_SETTINGS, ...value };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_SETTINGS;
      throw new Error("Codgram could not read its local settings.");
    }
  }

  async saveSettings(settings: CodgramSettings): Promise<CodgramSettings> {
    await this.enqueueWrite(async () => {
      await this.ensureDirectory();
      const nextPath = `${this.settingsPath}.next`;
      await fs.writeFile(nextPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
      await fs.rename(nextPath, this.settingsPath);
    });
    return settings;
  }
}

export const localHistory = new LocalHistoryStore();
