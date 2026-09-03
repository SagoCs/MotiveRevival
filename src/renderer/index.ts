import '@fontsource/sora/300.css';
import '@fontsource/sora/400.css';
import '@fontsource/sora/600.css';
import '@fontsource/ibm-plex-mono/400.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/river.css';

import { player } from './core/player';
import { appBus } from './core/appBus';
import type { IndexedTrack } from '../shared/types';
import { libraryStore } from './core/libraryStore';
import { applyMotionFlags, applyLyricSize, applyTimelineLyricSize } from './core/fx';
import { onMoment } from './core/moments';
import { enqueueIdle } from './core/peakAnalyzer';
import { lantern } from './core/lantern';
import { fatal } from './core/dom';
import { ICON_PAUSE, ICON_NEXT, ICON_PLAY, ICON_PREV } from './ui/icons';
import { initBrowser } from './ui/browser';
import { initOverlay } from './ui/overlay';
import { initSettingsPanel, applyLyricsLayout } from './ui/settings';
import { createTransport } from './ui/transport';
import { initWindowControls } from './ui/windowControls';
import { initArrowMarkers } from './ui/arrowMarkers';
import { initSongRiver } from './ui/songRiver';

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
  initArrowMarkers();
  initSongRiver();

  const arrowAnchor = (side: number): { x: number; y: number } | null => {
    const row = document.querySelector<HTMLElement>('.song-row.playing');
    if (row === null) return null;
    const rect = row.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return null;
    return { x: side < 0 ? rect.left - 54 : rect.right + 54, y: rect.top + rect.height / 2 };
  };

  let arrowSurfaceActive = false;
  const syncArrowSurface = (): void => {
    const songsTabActive =
      document.querySelector('#mode-tabs button[data-mode="songs"].active') !== null &&
      !document.body.classList.contains('song-river-active');
    const blocked = document.querySelector(
      '#overlay:not([hidden]), #detail-layer:not([hidden]), #playlist-layer:not([hidden]), #search-oracle:not([hidden]), #settings-modal:not([hidden]), #sort-popover:not([hidden])',
    ) !== null;
    const active = songsTabActive && !blocked;
    if (active === arrowSurfaceActive) return;
    arrowSurfaceActive = active;
    document.documentElement.classList.toggle('song-marker-surface', active);
    if (!active) lantern.clearArrowMotes();
  };

  window.setInterval(() => {
    syncArrowSurface();
    if (!arrowSurfaceActive || !player.playing) return;
    for (const side of [-1, 1]) {
      const a = arrowAnchor(side);
      if (a !== null) lantern.streamMote(a.x, a.y, side);
    }
  }, 330);

  onMoment((strength) => {
    syncArrowSurface();
    if (!arrowSurfaceActive) return;
    for (const side of [-1, 1]) {
      const a = arrowAnchor(side);
      if (a === null) continue;
      lantern.burstMotes(a.x, a.y, side, strength);
    }
  });

  const transportHost = document.getElementById('transport-host');
  const transport = transportHost !== null ? createTransport(transportHost) : null;
  initBrowser((text, upcoming) => transport?.setCompactLyric(text, upcoming));
  syncArrowSurface();
  new MutationObserver(syncArrowSurface).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'hidden'],
  });

  const rootInfo = document.querySelector<HTMLDivElement>('#root-info');

  void window.mr.getSettings().then((s) => {
    applyMotionFlags(s);
    applyLyricSize(s.lyricSize);
    applyTimelineLyricSize(s.timelineLyricSize);
    applyLyricsLayout(s.lyricAlign, s.lyricPane);
    player.setVolume(typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : 1);
    player.setLoopMode(s.loopMode === 'forever' ? 'forever' : 'off');
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
