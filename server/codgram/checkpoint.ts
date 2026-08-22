import { randomUUID } from "node:crypto";
import type { FileChange, RollbackCheckpoint } from "./types";

export function createRollbackCheckpoint(): RollbackCheckpoint {
  return { id: randomUUID(), createdAt: new Date().toISOString(), status: "ready", entries: [] };
}

export function recordRollbackChange(checkpoint: RollbackCheckpoint, change: FileChange): RollbackCheckpoint {
  if (checkpoint.status !== "ready") return checkpoint;
  const existing = checkpoint.entries.find(entry => entry.path === change.path);
  const entries = existing
    ? checkpoint.entries.map(entry => entry.path === change.path ? { ...entry, expectedAfter: change.after } : entry)
    : [...checkpoint.entries, { path: change.path, before: change.before, expectedAfter: change.after }];
  return { ...checkpoint, entries };
}
