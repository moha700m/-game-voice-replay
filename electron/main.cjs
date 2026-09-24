const {
  app,
  BrowserWindow,
  globalShortcut,
  net,
  protocol,
  session,
  shell,
} = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_ORIGIN = 'gvr://app';
const DIST_ROOT = path.resolve(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'gvr',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let mainWindow = null;

function resolveAppFile(requestUrl) {
  const url = new URL(requestUrl);
  const rawPath = decodeURIComponent(url.pathname || '/');
  const relativePath =
    rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
  const requested = path.resolve(DIST_ROOT, relativePath);
  const rootPrefix = (DIST_ROOT + path.sep).toLowerCase();
  const requestedLower = requested.toLowerCase();

  if (
    requestedLower !== DIST_ROOT.toLowerCase() &&
    !requestedLower.startsWith(rootPrefix)
  ) {
    return null;
  }

  return requested;
}

async function registerAppProtocol() {
  protocol.handle('gvr', request => {
    const filePath = resolveAppFile(request.url);
    if (!filePath) {
      return new Response('Not found', { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function sendHotkey(code) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop-hotkey', code);
}

function registerGlobalHotkeys() {
  const shortcuts = new Map([
    ['CommandOrControl+Shift+1', 'Digit1'],
    ['CommandOrControl+Shift+2', 'Digit2'],
    ['CommandOrControl+Shift+3', 'Digit3'],
    ['CommandOrControl+Shift+4', 'Digit4'],
  ]);

  for (const [accelerator, code] of shortcuts) {
    const registered = globalShortcut.register(accelerator, () =>
      sendHotkey(code)
    );
    if (!registered) {
      console.warn('Could not register global shortcut:', accelerator);
    }
  }

  globalShortcut.register('CommandOrControl+Shift+0', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.minimize();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 920,
    minHeight: 680,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      event.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        void shell.openExternal(url);
      }
    }
  });

  void mainWindow.loadURL(APP_ORIGIN + '/index.html');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  await registerAppProtocol();

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === 'media');
    }
  );

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === 'media'
  );

  createWindow();
  registerGlobalHotkeys();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  protocol.unhandle('gvr');
});

app.on('window-all-closed', () => {
  app.quit();
});
