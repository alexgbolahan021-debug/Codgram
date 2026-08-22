function createCodgramDesktopEnvironment(baseEnvironment, { port, workspaceRoot, workspaceId, isPackaged, providerApiKey }) {
  return {
    ...baseEnvironment,
    PORT: String(port),
    CODGRAM_WORKSPACE_ROOT: workspaceRoot,
    ...(workspaceId ? { CODGRAM_WORKSPACE_ID: workspaceId } : {}),
    ...(providerApiKey ? { CODGRAM_OPENAI_API_KEY: providerApiKey } : {}),
    NODE_ENV: isPackaged ? "production" : "development",
  };
}

module.exports = { createCodgramDesktopEnvironment };
