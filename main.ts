import { app, BrowserWindow, Menu, ipcMain, dialog, globalShortcut, shell, IpcMainInvokeEvent, IpcMainEvent } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import SessionManager from './src/session-manager';
import ShellManager from './src/shell-manager';
import NotificationService from './src/notification';

const RECENT_DIRS_PATH = path.join(os.homedir(), '.claude-session-manager', 'recent-dirs.json');
const MAX_RECENT_DIRS = 10;

function loadRecentDirs(): string[] {
  try {
    return JSON.parse(fs.readFileSync(RECENT_DIRS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveRecentDir(dir: string): void {
  let dirs = loadRecentDirs();
  dirs = dirs.filter(d => d !== dir);
  dirs.unshift(dir);
  dirs = dirs.slice(0, MAX_RECENT_DIRS);
  const dirPath = path.dirname(RECENT_DIRS_PATH);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(RECENT_DIRS_PATH, JSON.stringify(dirs, null, 2));
}

function isRiskyPath(cwd: string): boolean {
  const home = os.homedir();
  const riskyPaths = ['/', '/tmp', '/var', '/etc', '/usr', '/System', '/Applications', home];
  return riskyPaths.includes(cwd);
}

app.name = 'Claude Session Manager';

let mainWindow: BrowserWindow | null = null;
let sessionManager: SessionManager | null = null;
let shellManager: ShellManager | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
  });

  const appName = 'Claude Session Manager';
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: appName,
      submenu: [
        { role: 'about', label: `About ${appName}` },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${appName}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${appName}` },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  const win = mainWindow;

  sessionManager = new SessionManager();
  shellManager = new ShellManager();
  const notificationService = new NotificationService(sessionManager, win);

  shellManager.on('output', (sessionId: string, data: string) => {
    win.webContents.send('shell:output', sessionId, data);
  });

  shellManager.on('exit', (sessionId: string, exitCode: number) => {
    win.webContents.send('shell:exit', sessionId, exitCode);
  });

  sessionManager.on('cwd-change', (sessionId: string, newCwd: string) => {
    if (shellManager!.hasShell(sessionId)) {
      shellManager!.cdTo(sessionId, newCwd);
    }
  });

  sessionManager.on('output', (sessionId: string, data: string) => {
    win.webContents.send('session:output', sessionId, data);
  });

  sessionManager.on('state-change', (sessionId: string, state: string) => {
    win.webContents.send('session:state', sessionId, state);
  });

  sessionManager.on('exit', (sessionId: string, exitCode: number) => {
    win.webContents.send('session:exit', sessionId, exitCode);
  });

  // Keyboard shortcuts
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown' || !input.meta) return;
    if (input.key === 'n') {
      win.webContents.send('new-session');
    } else if (input.shift && input.key === 't') {
      win.webContents.send('toggle-terminal');
    }
  });

  ipcMain.handle('session:create', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Choose working directory for Claude session',
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const cwd = path.resolve(result.filePaths[0]);
    if (isRiskyPath(cwd)) {
      dialog.showErrorBox(
        'Invalid directory',
        `"${cwd}" is too broad to use as a working directory. Please choose a specific project folder.`,
      );
      return null;
    }

    saveRecentDir(cwd);
    const session = sessionManager!.createSession(cwd);
    return { id: session.id, name: session.name, cwd: session.cwd, status: session.status };
  });

  ipcMain.handle('session:recent-dirs', () => {
    return loadRecentDirs();
  });

  ipcMain.handle('session:create-with-dir', async (_event: IpcMainInvokeEvent, cwd: string) => {
    cwd = path.resolve(cwd);
    if (isRiskyPath(cwd)) {
      dialog.showErrorBox(
        'Invalid directory',
        `"${cwd}" is too broad to use as a working directory. Please choose a specific project folder.`,
      );
      return null;
    }
    if (!fs.existsSync(cwd)) {
      dialog.showErrorBox('Directory not found', `"${cwd}" does not exist.`);
      return null;
    }

    saveRecentDir(cwd);
    const session = sessionManager!.createSession(cwd);
    return { id: session.id, name: session.name, cwd: session.cwd, status: session.status };
  });

  ipcMain.on('session:active', (_event: IpcMainEvent, sessionId: string) => {
    notificationService.setActiveSession(sessionId, win.isFocused());
  });

  win.on('focus', () => {
    notificationService.setWindowFocused(true);
  });

  win.on('blur', () => {
    notificationService.setWindowFocused(false);
  });

  ipcMain.on('session:input', (_event: IpcMainEvent, sessionId: string, data: string) => {
    sessionManager?.write(sessionId, data);
  });

  ipcMain.on('session:resize', (_event: IpcMainEvent, sessionId: string, cols: number, rows: number) => {
    sessionManager?.resize(sessionId, cols, rows);
  });

  ipcMain.handle('session:kill', (_event: IpcMainInvokeEvent, sessionId: string) => {
    shellManager?.killShell(sessionId);
    sessionManager?.killSession(sessionId);
  });

  ipcMain.handle('session:list', () => {
    return sessionManager!.getSessions().map(s => ({
      id: s.id, name: s.name, cwd: s.cwd, status: s.status,
    }));
  });

  ipcMain.handle('session:buffer', (_event: IpcMainInvokeEvent, sessionId: string) => {
    return sessionManager!.getBuffer(sessionId);
  });

  // Shell IPC handlers
  ipcMain.handle('shell:create', (_event: IpcMainInvokeEvent, sessionId: string) => {
    const session = sessionManager!.sessions.get(sessionId);
    if (!session) return '';
    return shellManager!.createShell(sessionId, session.cwd);
  });

  ipcMain.handle('shell:buffer', (_event: IpcMainInvokeEvent, sessionId: string) => {
    return shellManager!.getBuffer(sessionId);
  });

  ipcMain.handle('open-external', (_event: IpcMainInvokeEvent, url: string) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  ipcMain.on('shell:input', (_event: IpcMainEvent, sessionId: string, data: string) => {
    shellManager?.write(sessionId, data);
  });

  ipcMain.on('shell:resize', (_event: IpcMainEvent, sessionId: string, cols: number, rows: number) => {
    shellManager?.resize(sessionId, cols, rows);
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock?.setIcon(path.join(__dirname, '..', 'assets', 'icon.png'));
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (shellManager) shellManager.killAll();
  if (sessionManager) sessionManager.killAll();
  app.quit();
});
