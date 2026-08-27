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

  const blurArt = document.createElement('div');
  blurArt.id = 'overlay-blur-art';
  blurArt.setAttribute('aria-hidden', 'true');
  document.getElementById('overlay-field')?.insertAdjacentElement('afterend', blurArt);

  for (const side of ['left', 'right'] as const) {
    const zone = document.createElement('div');
    zone.className = `blur-zone zone-${side}`;
    zone.addEventListener('click', () => {
      if (!hasLyrics) return;
      savedView = side === 'left' ? 'art' : 'split';
      void window.mr.updateSettings({ nowPlayingView: savedView });
      applySavedView();
    });
    overlay.append(zone);
  }

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
    overlay.classList.toggle('blur-mode', view === 'blur');
  };

  const cycleFocus = (): void => {
    if (!hasLyrics) {
      artHost.classList.remove('reject-shake');
      void artHost.offsetWidth;
      artHost.classList.add('reject-shake');
      window.setTimeout(() => artHost.classList.remove('reject-shake'), 340);
      return;
    }
    const next: Record<NowPlayingView, NowPlayingView> = { art: 'blur', blur: 'split', split: 'art' };
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
      blurArt.style.backgroundImage = `url("media://local/${encodeURIComponent(current.artFile)}")`;
    } else {
      artHost.innerHTML = ICON_SIGIL;
      blurArt.style.backgroundImage = '';
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
    savedView = s.nowPlayingView === 'split' || s.nowPlayingView === 'blur' ? s.nowPlayingView : 'art';
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
