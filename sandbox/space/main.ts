import { app, BrowserWindow, Menu } from 'electron';
import { join } from 'node:path';

app.commandLine.appendSwitch('remote-debugging-port', '9224');

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    show: false,
    backgroundColor: '#08090b',
    title: 'Space Lab',
    webPreferences: {
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    else if (input.key === 'Escape') app.quit();
    else if (input.control && input.key === 'r') {
      if (input.shift) win.webContents.reloadIgnoringCache();
      else win.webContents.reload();
    }
  });
  void win.loadFile(join(__dirname, 'index.html'));
};

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
