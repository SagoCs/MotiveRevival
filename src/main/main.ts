import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage } from 'electron';
import { join } from 'node:path';
import { getSettings, saveSettings } from './settings';
import { scanLibrary, loadCachedIndex, artCacheDir } from './library';
import { resolveLyrics } from './lyrics';
import { kvGet, kvSet, flushKv } from './storage';
import { registerMediaScheme, attachMediaHandler } from './media';
import type { LibraryResult, LyricsPayload, LyricsResult, Settings } from '../shared/types';

registerMediaScheme();
Menu.setApplicationMenu(null);
app.on('before-quit', () => flushKv());

let mainWindow: BrowserWindow | null = null;

const userDirArg = process.argv.find((a) => a.startsWith('--user-data-dir='));
if (userDirArg !== undefined) {
  app.setPath('userData', userDirArg.slice('--user-data-dir='.length));
}

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
    attachMediaHandler(() => [...getSettings().musicDirs, artCacheDir()]);
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
  ipcMain.on('taskbar:icons', (e, icons: { prev: string; play: string; pause: string; next: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win === null) return;
    thumbar.prev = nativeImage.createFromDataURL(icons.prev);
    thumbar.play = nativeImage.createFromDataURL(icons.play);
    thumbar.pause = nativeImage.createFromDataURL(icons.pause);
    thumbar.next = nativeImage.createFromDataURL(icons.next);
    thumbar.have = true;
    applyThumbar(win);
  });
  ipcMain.on('taskbar:progress', (e, fraction: number) => {
    BrowserWindow.fromWebContents(e.sender)?.setProgressBar(typeof fraction === 'number' && fraction >= 0 ? fraction : -1);
  });
  ipcMain.on('taskbar:playing', (e, playing: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win === null) return;
    thumbar.playing = playing !== false;
    applyThumbar(win);
  });
  ipcMain.on('taskbar:track-changed', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.flashFrame(true);
  });
}

interface ThumbarState {
  prev: Electron.NativeImage;
  play: Electron.NativeImage;
  pause: Electron.NativeImage;
  next: Electron.NativeImage;
  have: boolean;
  playing: boolean;
}

const thumbar: ThumbarState = {
  prev: null as unknown as Electron.NativeImage,
  play: null as unknown as Electron.NativeImage,
  pause: null as unknown as Electron.NativeImage,
  next: null as unknown as Electron.NativeImage,
  have: false,
  playing: false,
};

function applyThumbar(win: BrowserWindow): void {
  if (!thumbar.have) return;
  win.setThumbarButtons([
    { icon: thumbar.prev, click: () => win.webContents.send('taskbar:command', 'prev') },
    { icon: thumbar.playing ? thumbar.pause : thumbar.play, click: () => win.webContents.send('taskbar:command', 'toggle') },
    { icon: thumbar.next, click: () => win.webContents.send('taskbar:command', 'next') },
  ]);
}

function scheduleScan(): void {
  const win = mainWindow;
  if (!win) return;
  const settings = getSettings();
  void scanLibrary({
    roots: settings.musicDirs,
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
          roots: settings.musicDirs,
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
  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>): Settings => {
    const allowed: Partial<Settings> = {};
    const keys: Array<keyof Settings> = [
      'motionEffects',
      'motionCarousel',
      'motionPulse',
      'motionMorph',
      'autoFetchLyrics',
      'lyricsSaveBeside',
      'lyricSize',
      'nowPlayingView',
    ];
    for (const key of keys) {
      if (patch[key] !== undefined) (allowed as Record<string, unknown>)[key] = patch[key];
    }
    return saveSettings(allowed);
  });
  ipcMain.handle('archives:add', async (): Promise<Settings> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections'],
      defaultPath: getSettings().musicDirs[0],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const current = getSettings().musicDirs;
      const merged = [...current];
      for (const dir of result.filePaths) {
        if (!merged.some((d) => d.toLowerCase() === dir.toLowerCase())) merged.push(dir);
      }
      const settings = saveSettings({ musicDirs: merged });
      scheduleScan();
      return settings;
    }
    return getSettings();
  });
  ipcMain.handle('archives:remove', (_e, dir: string): Settings => {
    const remaining = getSettings().musicDirs.filter((d) => d.toLowerCase() !== dir.toLowerCase());
    const settings =
      remaining.length > 0 ? saveSettings({ musicDirs: remaining }) : getSettings();
    if (remaining.length > 0 || settings.musicDirs.length === 0) scheduleScan();
    return settings;
  });
  ipcMain.handle('library:list', async (): Promise<LibraryResult> => {
    const roots = getSettings().musicDirs;
    return loadCachedIndex(roots) ?? { ok: true, roots, tracks: [] };
  });
  ipcMain.handle('lyrics:get', async (_e, payload: LyricsPayload): Promise<LyricsResult> => {
    const settings = getSettings();
    return resolveLyrics(
      payload,
      settings.autoFetchLyrics !== false,
      settings.lyricsSaveBeside !== false,
    );
  });
  ipcMain.handle('storage:get', (_e, key: string) => kvGet(key));
  ipcMain.handle('storage:set', (_e, key: string, value: unknown) => {
    kvSet(key, value);
  });
}
