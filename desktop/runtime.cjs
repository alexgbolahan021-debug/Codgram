const { toWorkspaceSelection } = require("./contract.cjs");

function createWorkspaceSelectionHandler({ showOpenDialog, restartServer, reloadWindow, setWorkspaceId }) {
  return async function chooseProjectFolder(parentWindow) {
    const result = await showOpenDialog(parentWindow, {
      title: "Choose a Codgram project folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    const selection = toWorkspaceSelection(result.filePaths[0]);
    setWorkspaceId(selection.workspaceId);
    await restartServer(selection.workspaceRoot);
    await reloadWindow();
    return { cancelled: false, workspaceId: selection.workspaceId };
  };
}

module.exports = { createWorkspaceSelectionHandler };
