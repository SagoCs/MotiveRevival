import { player } from '../core/player';
import { appBus } from '../core/appBus';
import { startBands, stopBands } from '../core/audioBands';
import { fallbackPalette, applyPalette, applyLyricsInk } from '../core/palette';
import { fx } from '../core/fx';
import { createTransport } from './transport';
import { createLyrics, type LyricsState } from './lyrics';
import type { IndexedTrack, NowPlayingView } from '../../shared/types';
import { ICON_DIAMOND, ICON_NOTE, ICON_SIGIL } from './icons';
import { Viz } from './viz';

export function initOverlay(): void {
  const overlay = document.querySelector<HTMLDivElement>('#overlay');
  const artHost = document.querySelector<HTMLDivElement>('#overlay-sigil');
  const titleEl = document.querySelector<HTMLHeadingElement>('#overlay-title');
  const mark = document.querySelector<HTMLDivElement>('#veil-mark');
  const toggleBtn = document.querySelector<HTMLButtonElement>('#overlay-toggle');

  if (!overlay || !artHost || !titleEl) return;
  if (mark) mark.innerHTML = ICON_DIAMOND;
  if (toggleBtn) {
    toggleBtn.innerHTML = ICON_NOTE;
    toggleBtn.addEventListener('click', () => closeNowPlaying());
  }

  artHost.classList.add('clickable');
  artHost.title = 'Cycle focus: split ⇄ art';
  titleEl.classList.add('clickable');
  titleEl.title = 'Cycle focus';

  const transportHost = document.querySelector<HTMLDivElement>('#overlay-transport');
  if (transportHost) createTransport(transportHost);

  const vizCanvas = document.querySelector<HTMLCanvasElement>('#overlay-viz');
  if (vizCanvas !== null) new Viz(vizCanvas, overlay);

  const artVeil = document.createElement('div');
  artVeil.id = 'overlay-art-veil';
  artVeil.setAttribute('aria-hidden', 'true');
  document.getElementById('overlay-field')?.insertAdjacentElement('afterend', artVeil);

  for (const side of ['left', 'right'] as const) {
    const zone = document.createElement('div');
    zone.className = `lyrics-zone zone-${side}`;
    zone.addEventListener('click', () => {
      if (!hasLyrics) return;
      savedView = side === 'left' ? 'art' : 'split';
      void window.mr.updateSettings({ nowPlayingView: savedView });
      applySavedView();
    });
    overlay.append(zone);
  }

  const modeDots = document.createElement('div');
  modeDots.id = 'mode-dots';
  for (const view of ['art', 'split', 'lyrics'] as const) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'mode-dot';
    dot.dataset.view = view;
    dot.title = view === 'art' ? 'Art view' : view === 'split' ? 'Art + lyrics' : 'Lyrics only';
    dot.addEventListener('click', () => {
      if (!hasLyrics) {
        dot.classList.remove('reject-shake');
        void dot.offsetWidth;
        dot.classList.add('reject-shake');
        window.setTimeout(() => dot.classList.remove('reject-shake'), 340);
        return;
      }
      savedView = view;
      void window.mr.updateSettings({ nowPlayingView: savedView });
      applySavedView();
    });
    modeDots.append(dot);
  }
  overlay.append(modeDots);

  const lyricsPane = document.getElementById('overlay-lyrics');
  let overlayLyrics: ReturnType<typeof createLyrics> | null = null;
  if (lyricsPane !== null) {
    overlayLyrics = createLyrics(
      lyricsPane,
      (state: LyricsState) => {
        hasLyrics = state === 'synced' || state === 'plain';
        overlay.classList.toggle('with-lyrics', hasLyrics);
        lyricsPane.hidden = !hasLyrics;
        applySavedView();
      },
      undefined,
      { pannable: true },
    );
  }

  let current: IndexedTrack | null = null;
  let hasLyrics = false;
  let savedView: NowPlayingView = 'art';

  const applySavedView = (): void => {
    const view = hasLyrics ? savedView : 'art';
    overlay.classList.toggle('art-focus', view === 'art');
    overlay.classList.toggle('lyrics-mode', view === 'lyrics');
    for (const dot of Array.from(modeDots.children)) {
      const d = dot as HTMLElement;
      d.classList.toggle('active', d.dataset.view === view);
      d.classList.toggle('locked', !hasLyrics && d.dataset.view !== 'art');
    }
  };

  const attachModeHotkeys = (): void => {
    const keyMap: Record<string, NowPlayingView> = { '1': 'art', '2': 'split', '3': 'lyrics' };
    document.addEventListener('keydown', (e) => {
      if (overlay.hidden) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const view = keyMap[e.key];
      if (view === undefined) return;
      if (view !== 'art' && !hasLyrics) return;
      savedView = view;
      void window.mr.updateSettings({ nowPlayingView: savedView });
      applySavedView();
    });
  };
  attachModeHotkeys();

  const cycleFocus = (): void => {
    if (!hasLyrics) {
      artHost.classList.remove('reject-shake');
      void artHost.offsetWidth;
      artHost.classList.add('reject-shake');
      window.setTimeout(() => artHost.classList.remove('reject-shake'), 340);
      return;
    }
    const next: Record<NowPlayingView, NowPlayingView> = { art: 'split', split: 'lyrics', lyrics: 'art' };
    savedView = next[savedView];
    void window.mr.updateSettings({ nowPlayingView: savedView });
    applySavedView();
  };

  artHost.addEventListener('click', cycleFocus);
  titleEl.addEventListener('click', cycleFocus);

  const render = (): void => {
    if (current !== null && current.artFile !== null) {
      const img = document.createElement('img');
      img.className = 'overlay-img';
      img.alt = '';
      img.src = `media://local/${encodeURIComponent(current.artFile)}`;
      artHost.replaceChildren(img);
      artVeil.style.backgroundImage = `url("media://local/${encodeURIComponent(current.artFile)}")`;
    } else {
      artHost.innerHTML = ICON_SIGIL;
      artVeil.style.backgroundImage = '';
    }
    titleEl.textContent = current !== null ? current.title : '';
  };

  appBus.on('track-selected', ({ track }) => {
    current = track;
    hasLyrics = false;
    applySavedView();
    applyPalette(overlay, track.palette ?? fallbackPalette(track.id));
    applyLyricsInk(overlay, track.palette);
    overlayLyrics?.setTrack(track);
    render();
  });

  void window.mr.getSettings().then((s) => {
    const loaded = s.nowPlayingView as string | undefined;
    savedView =
      loaded === 'split' || loaded === 'lyrics'
        ? (loaded as NowPlayingView)
        : loaded === 'blur'
          ? 'lyrics'
          : 'art';
    applySavedView();
  });
}

export function isOverlayOpen(): boolean {
  const overlay = document.querySelector<HTMLDivElement>('#overlay');
  return overlay !== null && !overlay.hidden;
}

export function openNowPlaying(): void {
  setOverlay(true);
}

export function openNowPlayingFromRect(from: DOMRect | null, imageUrl: string | null): void {
  const overlay = document.querySelector<HTMLDivElement>('#overlay');
  if (overlay === null) return;
  const animate = fx.motion && fx.morph && from !== null && from.width > 4 && from.height > 4;
  setOverlay(true);
  if (!animate || from === null) return;

  const target = document.getElementById('overlay-sigil');
  if (target === null) return;
  target.style.opacity = '0';

  const isArtMode = overlay.classList.contains('art-focus');
  if (!isArtMode) overlay.classList.add('morphing');

  const ghost = document.createElement('div');
  ghost.className = 'morph-ghost';
  if (imageUrl !== null) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = imageUrl;
    ghost.append(img);
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const dest = target.getBoundingClientRect();
      if (dest.width < 4 || dest.height < 4) {
        ghost.remove();
        target.style.opacity = '';
        return;
      }
      ghost.style.left = `${dest.left}px`;
      ghost.style.top = `${dest.top}px`;
      ghost.style.width = `${dest.width}px`;
      ghost.style.height = `${dest.height}px`;
      ghost.style.borderRadius = getComputedStyle(target).borderRadius;
      document.body.append(ghost);

      const dx = from.left - dest.left;
      const dy = from.top - dest.top;
      const sx = from.width / dest.width;
      const sy = from.height / dest.height;
      ghost.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          ghost.classList.add('run');
          ghost.style.transform = 'translate(0, 0) scale(1, 1)';
        });
      });

      window.setTimeout(() => {
        ghost.remove();
        target.style.opacity = '';
        overlay.classList.remove('morphing');
      }, 640);
    });
  });
}

export function closeNowPlaying(): void {
  setOverlay(false);
}

export function toggleNowPlaying(): void {
  if (isOverlayOpen()) closeNowPlaying();
  else openNowPlaying();
}

function setOverlay(open: boolean): void {
  const overlay = document.querySelector<HTMLDivElement>('#overlay');
  if (!overlay) return;
  overlay.hidden = !open;
  requestAnimationFrame(() => overlay.classList.toggle('open', open));
  if (open) {
    startBands();
  } else {
    stopBands();
  }
}
