const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { toWorkspaceSelection } = require("./contract.cjs");
const { createWorkspaceSelectionHandler } = require("./runtime.cjs");
const { createCodgramDesktopEnvironment } = require("./environment.cjs");
const { createDesktopWorkspaceState } = require("./state.cjs");

const projectRoot = path.resolve(__dirname, "..");
const desktopPort = Number(process.env.CODGRAM_DESKTOP_PORT || 4599);
const serverUrl = `http://127.0.0.1:${desktopPort}`;
let serverProcess = null;
let mainWindow = null;
const workspaceState = createDesktopWorkspaceState();

function packageCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function isPortAvailable(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

async function waitForPortRelease(timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortAvailable(desktopPort)) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("The previous Codgram local server did not release its port.");
}

function terminateServerGroup(processHandle, signal) {
  if (!processHandle?.pid) return;
  if (process.platform === "win32") {
    processHandle.kill(signal);
    return;
  }
  try {
    process.kill(-processHandle.pid, signal);
  } catch {
    processHandle.kill(signal);
  }
}

async function stopServer() {
  const existing = serverProcess;
  if (!existing) return;
  await new Promise(resolve => {
    const timeout = setTimeout(() => {
      terminateServerGroup(existing, "SIGKILL");
      resolve();
    }, 5_000);
    existing.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    terminateServerGroup(existing, "SIGTERM");
  });
  if (serverProcess === existing) serverProcess = null;
  await waitForPortRelease();
}

function waitForServer(timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(serverUrl, response => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) return resolve();
        if (Date.now() >= deadline) return reject(new Error("Codgram local server did not become ready."));
        setTimeout(probe, 250);
      });
      request.on("error", () => {
        if (Date.now() >= deadline) return reject(new Error("Codgram local server did not become ready."));
        setTimeout(probe, 250);
      });
      request.setTimeout(1_000, () => request.destroy());
    };
    probe();
  });
}

async function startServer(workspaceRoot) {
  await stopServer();
  const environment = createCodgramDesktopEnvironment(process.env, {
    port: desktopPort,
    workspaceRoot,
    workspaceId: workspaceState.getWorkspaceId(),
    isPackaged: app.isPackaged,
  });
  const command = app.isPackaged ? process.execPath : packageCommand();
  const args = app.isPackaged ? [path.join(projectRoot, "dist", "index.js")] : ["dev"];
  serverProcess = spawn(command, args, { cwd: projectRoot, env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
  serverProcess.once("exit", () => { serverProcess = null; });
  await waitForServer();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1080,
    minHeight: 720,
    title: "Codgram",
    backgroundColor: "#08090f",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(serverUrl)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", event => {
    if (!event.url.startsWith(serverUrl)) event.preventDefault();
  });
}

const chooseProjectFolder = createWorkspaceSelectionHandler({
  showOpenDialog: dialog.showOpenDialog,
  restartServer: startServer,
  reloadWindow: () => mainWindow.loadURL(serverUrl),
  setWorkspaceId: workspaceId => workspaceState.setWorkspaceId(workspaceId),
});

ipcMain.handle("codgram:workspace-state", () => workspaceState.toRendererState());
ipcMain.handle("codgram:choose-project-folder", () => chooseProjectFolder(mainWindow));

app.whenReady().then(async () => {
  app.setName("Codgram");
  createWindow();
  await startServer(projectRoot);
  await mainWindow.loadURL(serverUrl);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => {
  dialog.showErrorBox("Codgram could not start", error instanceof Error ? error.message : "Unknown local runtime error.");
  app.quit();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", stopServer);
