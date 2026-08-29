import '@fontsource/sora/300.css';
import '@fontsource/sora/400.css';
import '@fontsource/sora/600.css';
import '@fontsource/ibm-plex-mono/400.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/lantern.css';

import { player } from './core/player';
import { libraryStore } from './core/libraryStore';
import { applyMotionFlags, applyLyricSize } from './core/fx';
import { enqueueIdle } from './core/peakAnalyzer';
import { fatal } from './core/dom';
import { initBrowser } from './ui/browser';
import { initOverlay } from './ui/overlay';
import { initSettingsPanel } from './ui/settings';
import { createTransport } from './ui/transport';
import { initWindowControls } from './ui/windowControls';
import { initLantern } from './ui/lantern';

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
  initLantern();

  const transportHost = document.getElementById('transport-host');
  const transport = transportHost !== null ? createTransport(transportHost) : null;
  initBrowser((text, upcoming) => transport?.setCompactLyric(text, upcoming));

  const rootInfo = document.querySelector<HTMLDivElement>('#root-info');

  void window.mr.getSettings().then((s) => {
    applyMotionFlags(s);
    applyLyricSize(s.lyricSize);
  });

  void window.mr.listTracks().then((result) => {
    libraryStore.set(result);
    if (result.ok) enqueueIdle(result.tracks);
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
        : `${label} · unreachable`;
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
