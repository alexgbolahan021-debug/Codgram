const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { toWorkspaceSelection } = require("./contract.cjs");
const { createWorkspaceSelectionHandler } = require("./runtime.cjs");
const { createCodgramDesktopEnvironment } = require("./environment.cjs");
const { createDesktopWorkspaceState } = require("./state.cjs");
const { createProviderSecretStore } = require("./provider-secret-store.cjs");

const projectRoot = path.resolve(__dirname, "..");
const desktopPort = Number(process.env.CODGRAM_DESKTOP_PORT || 4599);
const serverUrl = `http://127.0.0.1:${desktopPort}`;
const protectedSecretSmoke = process.env.CODGRAM_DESKTOP_V21_UI_SMOKE === "secret";
if (protectedSecretSmoke && process.env.CODGRAM_DATA_DIR) app.setPath("userData", path.join(process.env.CODGRAM_DATA_DIR, "electron-user-data"));
let serverProcess = null;
let mainWindow = null;
const workspaceState = createDesktopWorkspaceState();
const providerSecretStore = createProviderSecretStore({
  app,
  safeStorage: protectedSecretSmoke ? {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async value => Buffer.from(`sealed:${value}`, "utf8"),
    decryptStringAsync: async value => ({ result: value.toString("utf8").replace("sealed:", "") }),
  } : safeStorage,
  platform: protectedSecretSmoke ? "darwin" : process.platform,
});
let activeWorkspaceRoot = projectRoot;

function packageCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function desktopIconPath() {
  const file = process.platform === "win32" ? "icon.ico" : process.platform === "darwin" ? "icon.icns" : path.join("icons", "512x512.png");
  return path.join(__dirname, "build-resources", file);
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
  activeWorkspaceRoot = workspaceRoot;
  let providerApiKey = null;
  try { providerApiKey = await providerSecretStore.read(); }
  catch { console.warn("[Codgram] Protected provider-secret storage could not be read; using the normal local environment configuration."); }
  const environment = createCodgramDesktopEnvironment(process.env, {
    port: desktopPort,
    workspaceRoot,
    workspaceId: workspaceState.getWorkspaceId(),
    isPackaged: app.isPackaged,
    providerApiKey,
  });
  const command = app.isPackaged ? process.execPath : packageCommand();
  const args = app.isPackaged ? [path.join(projectRoot, "dist", "index.js")] : process.env.CODGRAM_DESKTOP_V21_UI_SMOKE ? ["exec", "tsx", "server/_core/index.ts"] : ["dev"];
  const smokeStdio = process.env.CODGRAM_DESKTOP_V21_UI_SMOKE ? "inherit" : ["ignore", "pipe", "pipe"];
  serverProcess = spawn(command, args, { cwd: projectRoot, env: environment, stdio: smokeStdio, windowsHide: true, detached: process.platform !== "win32" });
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
    icon: desktopIconPath(),
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

async function loadWorkspacePage() {
  await mainWindow.loadURL(`${serverUrl}/?workspace=${encodeURIComponent(workspaceState.getWorkspaceId() || "")}`);
  if (process.env.CODGRAM_DESKTOP_UI_ASSERT !== "1" || !workspaceState.getWorkspaceId()) return;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const renderedText = await mainWindow.webContents.executeJavaScript("document.body.innerText");
    if (renderedText.includes(workspaceState.getWorkspaceId())) {
      console.log(`[Codgram desktop UI assertion] selected workspace visible: ${workspaceState.getWorkspaceId()}`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  throw new Error("Codgram desktop renderer did not display the selected workspace.");
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForRendererText(text, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const renderedText = await mainWindow.webContents.executeJavaScript("document.body.innerText");
    if (renderedText.includes(text)) return;
    await wait(125);
  }
  const snapshot = await mainWindow.webContents.executeJavaScript("document.body.innerText");
  throw new Error(`Codgram desktop renderer did not display: ${text}. Rendered text: ${snapshot.slice(0, 1_500)}`);
}

async function clickRendererButton(label) {
  const clicked = await mainWindow.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find(item => item.innerText.trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Codgram desktop renderer did not expose the ${label} button.`);
}

async function clickRendererButtonContaining(text) {
  const clicked = await mainWindow.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find(item => item.innerText.includes(${JSON.stringify(text)}));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Codgram desktop renderer did not expose a button containing ${text}.`);
}

async function setRendererModel(value) {
  const updated = await mainWindow.webContents.executeJavaScript(`(() => {
    const selects = [...document.querySelectorAll("select")];
    const select = selects.find(item => [...item.options].some(option => option.value === ${JSON.stringify(value)}));
    if (!select || ![...select.options].some(option => option.value === ${JSON.stringify(value)})) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!updated) throw new Error(`Codgram desktop renderer did not expose the ${value} model option.`);
}

async function setRendererInput(label, value) {
  const updated = await mainWindow.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(`input[aria-label="${label}"]`)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!updated) throw new Error(`Codgram desktop renderer did not expose the ${label} input.`);
}

async function openRendererSettings() {
  const clicked = await mainWindow.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find(item => item.innerText.trim() === "Settings");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error("Codgram desktop renderer did not expose the Settings navigation button.");
  await waitForRendererText("Agent settings");
}

async function runProtectedSecretSmoke() {
  await openRendererSettings();
  await waitForRendererText("Protected local provider secret");
  await waitForRendererText("Protected by macOS Keychain.");
  await setRendererInput("Protected provider secret", "smoke-provider-secret");
  await clickRendererButton("Store securely");
  await waitForRendererText("What should Codgram build?");
  const secretPresentAfterStore = await mainWindow.webContents.executeJavaScript("document.body.innerText.includes('smoke-provider-secret')");
  if (secretPresentAfterStore) throw new Error("Codgram rendered a protected provider secret after it was stored.");
  await openRendererSettings();
  await waitForRendererText("Clear stored secret");
  await clickRendererButton("Clear stored secret");
  await waitForRendererText("What should Codgram build?");
  await openRendererSettings();
  await waitForRendererText("Store securely");
  console.log("[Codgram desktop protected-secret UI smoke] store, clear, and non-disclosure flow passed");
}

async function runV21UiSmoke() {
  const mode = process.env.CODGRAM_DESKTOP_V21_UI_SMOKE;
  if (!mode) return;
  if (mode === "secret") return runProtectedSecretSmoke();
  await waitForRendererText("Prepare your local agent");
  await clickRendererButtonContaining("OpenAI-compatible endpoint");
  await clickRendererButton("Continue");
  await waitForRendererText("Confirm your local configuration");
  await setRendererModel("smoke-coder");
  const credentialInputs = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('input[type=password], input[name*=\"key\" i], input[autocomplete*=\"key\" i]').length");
  if (credentialInputs) throw new Error("Codgram onboarding rendered a credential input, which is not permitted.");
  await clickRendererButton("Finish setup");
  await mainWindow.reload();
  await waitForRendererText("RUN CHECKPOINT");
  const onboardingStillVisible = await mainWindow.webContents.executeJavaScript("document.body.innerText.includes('Prepare your local agent')");
  if (onboardingStillVisible) throw new Error("Codgram onboarding reappeared after its completed local setting was reloaded.");
  await clickRendererButton("Restore checkpoint");
  await waitForRendererText("Revert this run’s tracked files?");
  await clickRendererButton("Restore files");
  if (mode === "conflict") await waitForRendererText("will not overwrite a newer change");
  else await waitForRendererText("Checkpoint restored");
  console.log(`[Codgram desktop V2.1 UI smoke] ${mode} flow passed`);
}

const chooseProjectFolder = createWorkspaceSelectionHandler({
  showOpenDialog: dialog.showOpenDialog,
  restartServer: startServer,
  reloadWindow: loadWorkspacePage,
  setWorkspaceId: workspaceId => workspaceState.setWorkspaceId(workspaceId),
});

ipcMain.handle("codgram:workspace-state", () => workspaceState.toRendererState());
ipcMain.handle("codgram:choose-project-folder", () => chooseProjectFolder(mainWindow));
ipcMain.handle("codgram:provider-secret-status", () => providerSecretStore.getStatus());
ipcMain.handle("codgram:save-provider-secret", async (_event, value) => {
  if (typeof value !== "string") throw new Error("Enter a valid provider secret.");
  const status = await providerSecretStore.save(value);
  await startServer(activeWorkspaceRoot);
  await loadWorkspacePage();
  return status;
});
ipcMain.handle("codgram:clear-provider-secret", async () => {
  const status = await providerSecretStore.clear();
  await startServer(activeWorkspaceRoot);
  await loadWorkspacePage();
  return status;
});

app.whenReady().then(async () => {
  app.setName("Codgram");
  createWindow();
  await startServer(projectRoot);
  const smokeProject = process.env.CODGRAM_DESKTOP_SMOKE_PROJECT;
  if (smokeProject) {
    const selection = toWorkspaceSelection(smokeProject);
    workspaceState.setWorkspaceId(selection.workspaceId);
    await startServer(selection.workspaceRoot);
  }
  await loadWorkspacePage();
  await runV21UiSmoke();
  if (process.env.CODGRAM_DESKTOP_V21_UI_SMOKE) app.quit();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => {
  if (process.env.CODGRAM_DESKTOP_V21_UI_SMOKE) {
    console.error("[Codgram desktop V2.1 UI smoke failure]", error instanceof Error ? error.stack : error);
    app.quit();
    return;
  }
  dialog.showErrorBox("Codgram could not start", error instanceof Error ? error.message : "Unknown local runtime error.");
  app.quit();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", stopServer);
