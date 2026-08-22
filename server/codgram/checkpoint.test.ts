import { describe, expect, it } from "vitest";
import { createRollbackCheckpoint, recordRollbackChange } from "./checkpoint";

describe("Codgram rollback checkpoints", () => {
  it("preserves each file’s state before the first change while tracking the latest expected state", () => {
    const initial = createRollbackCheckpoint();
    const first = recordRollbackChange(initial, { id: "1", path: "src/app.ts", kind: "edited", before: "one", after: "two", diff: "", at: "now" });
    const second = recordRollbackChange(first, { id: "2", path: "src/app.ts", kind: "edited", before: "two", after: "three", diff: "", at: "now" });

    expect(second.entries).toEqual([{ path: "src/app.ts", before: "one", expectedAfter: "three" }]);
  });
});
