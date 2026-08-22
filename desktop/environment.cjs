function createCodgramDesktopEnvironment(baseEnvironment, { port, workspaceRoot, workspaceId, isPackaged }) {
  return {
    ...baseEnvironment,
    PORT: String(port),
    CODGRAM_WORKSPACE_ROOT: workspaceRoot,
    ...(workspaceId ? { CODGRAM_WORKSPACE_ID: workspaceId } : {}),
    NODE_ENV: isPackaged ? "production" : "development",
  };
}

module.exports = { createCodgramDesktopEnvironment };
