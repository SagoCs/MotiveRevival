import { contextBridge, ipcRenderer } from 'electron';
import type {
  LibraryProgress,
  LibraryResult,
  LyricsPayload,
  LyricsResult,
  MrApi,
} from '../shared/types';

const api: MrApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  archivesAdd: () => ipcRenderer.invoke('archives:add'),
  archivesRemove: (dir: string) => ipcRenderer.invoke('archives:remove', dir),
  listTracks: () => ipcRenderer.invoke('library:list'),
  getLyrics: (payload: LyricsPayload) => ipcRenderer.invoke('lyrics:get', payload),
  storageGet: (key: string) => ipcRenderer.invoke('storage:get', key),
  storageSet: (key: string, value: unknown) => ipcRenderer.invoke('storage:set', key, value),
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  taskbar: {
    icons: (icons) => ipcRenderer.send('taskbar:icons', icons),
    progress: (fraction) => ipcRenderer.send('taskbar:progress', fraction),
    playing: (playing) => ipcRenderer.send('taskbar:playing', playing),
    trackChanged: () => ipcRenderer.send('taskbar:track-changed'),
  },
  onTaskbarCommand: (cb) => {
    const listener = (_e: unknown, command: 'prev' | 'toggle' | 'next'): void => cb(command);
    ipcRenderer.on('taskbar:command', listener);
    return () => ipcRenderer.removeListener('taskbar:command', listener);
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
