const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codgramDesktop", {
  isDesktop: true,
  getWorkspaceState: () => ipcRenderer.invoke("codgram:workspace-state"),
  chooseProjectFolder: () => ipcRenderer.invoke("codgram:choose-project-folder"),
});
