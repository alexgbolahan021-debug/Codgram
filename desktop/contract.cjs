const path = require("node:path");

function toWorkspaceSelection(folderPath) {
  if (typeof folderPath !== "string" || !folderPath.trim() || !path.isAbsolute(folderPath)) {
    throw new Error("Codgram requires an absolute local project folder.");
  }
  const normalized = path.resolve(folderPath);
  const workspaceId = path.basename(normalized);
  const workspaceRoot = path.dirname(normalized);
  if (!workspaceId || workspaceId === "." || workspaceRoot === normalized) {
    throw new Error("Choose a project folder rather than a filesystem root.");
  }
  return { workspaceId, workspaceRoot };
}

module.exports = { toWorkspaceSelection };
