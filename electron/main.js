// Electron main process for the JDE ERP desktop app.
//
// Flow on every launch:
//  1. Look for saved Supabase/Gemini credentials in this PC's per-user app data folder.
//  2. If missing, show the one-time setup screen and wait for the user to submit them.
//  3. Start the Next.js server (dev: `next dev`, packaged: the standalone build) with
//     those credentials as environment variables, wait for it to respond, then open the
//     main window pointed at it.
//
// Every PC this app is installed on does step 2 once. Because all data lives in Supabase
// (not on the PC), pointing multiple installs at the same project makes them all show the
// same live data — same as the web version, just as a native window instead of a browser tab.

const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
// JDE_TEST_PORT lets development/testing run alongside another instance of the app on
// the default port; a real install never sets this, so it always uses 3000.
const PORT = Number(process.env.JDE_TEST_PORT) || 3000;
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

let mainWindow = null;
let setupWindow = null;
let serverProcess = null;

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function isConfigComplete(config) {
  return !!(config && config.NEXT_PUBLIC_SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY);
}

function waitForServer(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('The app server did not start in time.'));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

function startServer(config) {
  const env = {
    ...process.env,
    ...config,
    PORT: String(PORT),
    NODE_ENV: isDev ? 'development' : 'production',
    ELECTRON_RUN_AS_NODE: '1',
  };

  if (isDev) {
    const appRoot = path.join(__dirname, '..');
    serverProcess = spawn(process.execPath, [path.join(appRoot, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', String(PORT)], {
      cwd: appRoot,
      env,
      stdio: 'inherit',
    });
  } else {
    const standaloneServer = path.join(process.resourcesPath, 'standalone', 'server.js');
    serverProcess = spawn(process.execPath, [standaloneServer], {
      cwd: path.dirname(standaloneServer),
      env,
      stdio: 'inherit',
    });
  }

  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`App server exited unexpectedly with code ${code}`);
    }
  });
}

function openMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Jai Durga ERP',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => console.error('Main window failed to load:', code, desc));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openSetupWindow(existingConfig) {
  setupWindow = new BrowserWindow({
    width: 560,
    height: 640,
    title: 'Jai Durga ERP — Setup',
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWindow.loadFile(path.join(__dirname, 'setup.html'));
  setupWindow.webContents.on('did-fail-load', (_e, code, desc) => console.error('Setup window failed to load:', code, desc));
  setupWindow.webContents.once('did-finish-load', () => {
    setupWindow.webContents.send('prefill', existingConfig ?? {});
  });
  setupWindow.on('closed', () => {
    setupWindow = null;
  });
}

async function boot() {
  const existingConfig = readConfig();

  ipcMain.handle('submit-config', async (_event, config) => {
    writeConfig(config);
    if (setupWindow) setupWindow.close();
    await launchApp(config);
    return { ok: true };
  });

  ipcMain.handle('open-external', (_event, url) => {
    shell.openExternal(url);
  });

  if (isConfigComplete(existingConfig)) {
    await launchApp(existingConfig);
  } else {
    openSetupWindow(existingConfig);
  }
}

async function launchApp(config) {
  startServer(config);
  try {
    await waitForServer(`http://localhost:${PORT}`, 30000);
  } catch (err) {
    console.error(err);
  }
  openMainWindow();
  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Reconfigure Supabase / AI keys…',
          click: () => openSetupWindow(readConfig()),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(boot);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const config = readConfig();
    if (isConfigComplete(config)) launchApp(config);
    else openSetupWindow(config);
  }
});
