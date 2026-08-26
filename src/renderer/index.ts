import '@fontsource/sora/300.css';
import '@fontsource/sora/400.css';
import '@fontsource/sora/600.css';
import '@fontsource/ibm-plex-mono/400.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';

import { player } from './core/player';
import { libraryStore } from './core/libraryStore';
import { fx } from './core/fx';
import { fatal } from './core/dom';
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
  initBrowser();
  initSettingsPanel(() => {});
  initWindowControls();

  const transportHost = document.getElementById('transport-host');
  if (transportHost) createTransport(transportHost);

  const rootInfo = document.querySelector<HTMLDivElement>('#root-info');

  void window.mr.getSettings().then((s) => {
    fx.motion = s.motionEffects !== false;
  });

  void window.mr.listTracks().then((result) => libraryStore.set(result));
  window.mr.onLibraryIndexed((result) => libraryStore.set(result));
  window.mr.onLibraryProgress(({ done, total }) => {
    if (rootInfo && total > 0) {
      const root = libraryStore.result?.root ?? '';
      rootInfo.textContent = `${root} · surveying ${done}/${total}…`;
    }
  });
  libraryStore.onChange((result) => {
    if (rootInfo) {
      rootInfo.textContent = result.ok
        ? `${result.root} · ${result.tracks.length} tracks`
        : `${result.root} · unreachable`;
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
