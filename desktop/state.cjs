function createDesktopWorkspaceState() {
  let workspaceId = null;
  return {
    getWorkspaceId: () => workspaceId,
    setWorkspaceId: value => { workspaceId = value || null; },
    toRendererState: () => ({ isDesktop: true, workspaceId }),
  };
}

module.exports = { createDesktopWorkspaceState };
