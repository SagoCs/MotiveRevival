import { contextBridge, ipcRenderer } from 'electron';
import type { LibraryProgress, LibraryResult, LyricsPayload, LyricsResult, MrApi } from '../shared/types';

const api: MrApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  setMusicDir: () => ipcRenderer.invoke('settings:set-music-dir'),
  listTracks: () => ipcRenderer.invoke('library:list'),
  getLyrics: (payload: LyricsPayload) => ipcRenderer.invoke('lyrics:get', payload),
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  onLibraryProgress: (cb: (p: LibraryProgress) => void) => {
    const listener = (_e: unknown, p: LibraryProgress): void => cb(p);
    ipcRenderer.on('library:progress', listener);
    return () => ipcRenderer.removeListener('library:progress', listener);
  },
  onLibraryIndexed: (cb: (r: LibraryResult) => void) => {
    const listener = (_e: unknown, r: LibraryResult): void => cb(r);
    ipcRenderer.on('library:indexed', listener);
    return () => ipcRenderer.removeListener('library:indexed', listener);
  },
};

contextBridge.exposeInMainWorld('mr', api);
