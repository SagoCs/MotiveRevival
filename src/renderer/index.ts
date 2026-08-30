import '@fontsource/sora/300.css';
import '@fontsource/sora/400.css';
import '@fontsource/sora/600.css';
import '@fontsource/ibm-plex-mono/400.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';

import { player } from './core/player';
import { appBus } from './core/appBus';
import type { IndexedTrack } from '../shared/types';
import { libraryStore } from './core/libraryStore';
import { applyMotionFlags, applyLyricSize } from './core/fx';
import { enqueueIdle } from './core/peakAnalyzer';
import { lantern } from './core/lantern';
import { fatal } from './core/dom';
import { ICON_PAUSE, ICON_NEXT, ICON_PLAY, ICON_PREV } from './ui/icons';
import { initBrowser } from './ui/browser';
import { initOverlay } from './ui/overlay';
import { initSettingsPanel } from './ui/settings';
import { createTransport } from './ui/transport';
import { initWindowControls } from './ui/windowControls';

window.addEventListener('error', (e) => {
  fatal(`Uncaught: ${e.message}`);
});
window.addEventListener('unhandledrejection', (e) => {
  fatal(`Rejected promise: ${String(e.reason)}`);
});

function boot(): void {
  if (!window.mr) {
    fatal('Bridge unavailable — preload script failed to run.');
    return;
  }

  void player;

  initOverlay();
  initSettingsPanel(() => {});
  initWindowControls();
  window.mr.onWindowState(({ maximizedOrFullscreen }) => {
    document.getElementById('topbar')?.classList.toggle('window-drag', !maximizedOrFullscreen);
  });
  lantern.init();

  const transportHost = document.getElementById('transport-host');
  const transport = transportHost !== null ? createTransport(transportHost) : null;
  initBrowser((text, upcoming) => transport?.setCompactLyric(text, upcoming));

  const rootInfo = document.querySelector<HTMLDivElement>('#root-info');

  void window.mr.getSettings().then((s) => {
    applyMotionFlags(s);
    applyLyricSize(s.lyricSize);
    player.setVolume(typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : 1);
  });

  appBus.on('track-selected', ({ track }) => {
    document.title = track.artist !== null
      ? `${track.title} - ${track.artist} · MotiveRevival`
      : `${track.title} · MotiveRevival`;
    window.mr.taskbar.trackChanged();
  });

  window.mr.onTaskbarCommand((command) => {
    if (command === 'prev') player.prev();
    else if (command === 'next') player.next();
    else player.toggle();
  });

  const thumbarSources: Array<[string, string]> = [
    ['prev', ICON_PREV],
    ['play', ICON_PLAY],
    ['pause', ICON_PAUSE],
    ['next', ICON_NEXT],
  ];
  const thumbarOut: Record<string, string> = {};
  let thumbarPending = thumbarSources.length;
  for (const [name, svg] of thumbarSources) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 20;
      c.height = 20;
      const ctx = c.getContext('2d');
      if (ctx !== null) ctx.drawImage(img, 0, 0, 20, 20);
      thumbarOut[name] = c.toDataURL('image/png');
      thumbarPending -= 1;
      if (thumbarPending === 0) {
        window.mr.taskbar.icons({
          prev: thumbarOut['prev'] ?? '',
          play: thumbarOut['play'] ?? '',
          pause: thumbarOut['pause'] ?? '',
          next: thumbarOut['next'] ?? '',
        });
      }
    };
    img.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace('<svg ', '<svg xmlns=\"http://www.w3.org/2000/svg\" ').replace(/currentColor/g, '#ffffff'))}`;
  }

  let lastSessionSave = 0;
  const saveSession = (position: number): void => {
    if (player.currentTrack === null) return;
    void window.mr.storageSet('session:v1', {
      paths: player.queueTracks.map((t) => t.absPath),
      index: player.queueIndexAt,
      position,
    });
  };
  player.bus.on('trackChanged', () => saveSession(player.currentTime));
  player.bus.on('state', () => saveSession(player.currentTime));
  player.bus.on('tick', ({ time }) => {
    const now = Date.now();
    if (now - lastSessionSave < 2500) return;
    lastSessionSave = now;
    saveSession(time);
  });

  let sessionRestored = false;
  void window.mr.listTracks().then((result) => {
    libraryStore.set(result);
    if (result.ok) enqueueIdle(result.tracks);
    if (!sessionRestored && result.ok && result.tracks.length > 0) {
      sessionRestored = true;
      void window.mr.storageGet('session:v1').then((raw) => {
        const saved = raw as { paths?: string[]; index?: number; position?: number } | null;
        if (saved === null || !Array.isArray(saved.paths) || saved.paths.length === 0) return;
        const byPath = new Map(result.tracks.map((t) => [t.absPath, t]));
        const queue = saved.paths
          .map((p) => byPath.get(p))
          .filter((t): t is IndexedTrack => t !== undefined);
        if (queue.length === 0) return;
        const index = Math.min(Math.max(saved.index ?? 0, 0), queue.length - 1);
        player.restoreContext(queue, index, Math.max(0, saved.position ?? 0));
      });
    }
  });
  window.mr.onLibraryIndexed((result) => {
    libraryStore.set(result);
    if (result.ok) enqueueIdle(result.tracks);
  });
  window.mr.onLibraryProgress(({ done, total }) => {
    if (rootInfo && total > 0) {
      const roots = libraryStore.result?.roots ?? [];
      const label = roots.length === 1 ? (roots[0] ?? '') : `${roots.length} archives`;
      rootInfo.textContent = `${label} · surveying ${done}/${total}…`;
    }
  });
  libraryStore.onChange((result) => {
    if (rootInfo) {
      const label =
        result.roots.length === 1
          ? (result.roots[0] ?? '')
          : `${result.roots.length} archives`;
      rootInfo.textContent = result.ok
        ? `${label} · ${result.tracks.length} tracks`
        : `${label} · folders unreachable`;
      rootInfo.title = result.ok
        ? ''
        : 'Some music folders could not be read — open settings to review them.';
    }
  });

  const veil = document.getElementById('veil');
  if (veil) {
    veil.classList.add('lifted');
    window.setTimeout(() => veil.remove(), 900);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
