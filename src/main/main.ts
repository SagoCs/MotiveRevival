import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { getSettings, saveSettings } from './settings';
import { scanLibrary, loadCachedIndex, artCacheDir } from './library';
import { resolveLyrics } from './lyrics';
import { registerMediaScheme, attachMediaHandler } from './media';
import type { LibraryResult, LyricsPayload, LyricsResult, Settings } from '../shared/types';

registerMediaScheme();
Menu.setApplicationMenu(null);

let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    attachMediaHandler(() => [getSettings().musicDir, artCacheDir()]);
    createWindow();
    registerIpc();
    scheduleScan();
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#05070f',
    title: 'MotiveRevival',
    show: false,
    frame: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  bindDeveloperShortcuts(win);
  bindWindowControls();
  void win.loadFile(join(__dirname, 'index.html'));
}

function bindWindowControls(): void {
  ipcMain.on('window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.on('window:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win === null) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close();
  });
}

function scheduleScan(): void {
  const win = mainWindow;
  if (!win) return;
  const settings = getSettings();
  void scanLibrary({
    musicDir: settings.musicDir,
    artDir: artCacheDir(),
    onProgress: (done, total) => {
      if (!win.isDestroyed()) win.webContents.send('library:progress', { done, total });
    },
  })
    .then((result) => {
      if (!win.isDestroyed()) win.webContents.send('library:indexed', result);
    })
    .catch((err) => {
      if (!win.isDestroyed()) {
        win.webContents.send('library:indexed', {
          ok: false,
          root: settings.musicDir,
          error: String(err),
        } satisfies LibraryResult);
      }
    });
}

function bindDeveloperShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (input.key === 'F12' || (input.control && input.shift && key === 'i')) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    } else if (input.key === 'F5' || (input.control && key === 'r')) {
      win.webContents.reload();
      event.preventDefault();
    }
  });
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>): Settings => saveSettings(patch));
  ipcMain.handle('settings:set-music-dir', async (): Promise<Settings | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: getSettings().musicDir,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const settings = saveSettings({ musicDir: result.filePaths[0] });
    scheduleScan();
    return settings;
  });
  ipcMain.handle('library:list', async (): Promise<LibraryResult> => {
    const root = getSettings().musicDir;
    return loadCachedIndex(root) ?? { ok: true, root, tracks: [] };
  });
  ipcMain.handle('lyrics:get', async (_e, payload: LyricsPayload): Promise<LyricsResult> => {
    const settings = getSettings();
    return resolveLyrics(payload, settings.autoFetchLyrics !== false);
  });
}
