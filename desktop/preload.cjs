const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codgramDesktop", {
  isDesktop: true,
  getWorkspaceState: () => ipcRenderer.invoke("codgram:workspace-state"),
  chooseProjectFolder: () => ipcRenderer.invoke("codgram:choose-project-folder"),
  getProviderSecretStatus: () => ipcRenderer.invoke("codgram:provider-secret-status"),
  saveProviderSecret: value => ipcRenderer.invoke("codgram:save-provider-secret", value),
  clearProviderSecret: () => ipcRenderer.invoke("codgram:clear-provider-secret"),
});
