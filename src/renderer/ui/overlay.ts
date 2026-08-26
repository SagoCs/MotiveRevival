import { player } from '../core/player';
import { appBus } from '../core/appBus';
import { startBands, stopBands } from '../core/audioBands';
import { fallbackPalette, applyPalette, applyLyricsInk } from '../core/palette';
import { createTransport } from './transport';
import { createLyrics, type LyricsState } from './lyrics';
import type { IndexedTrack } from '../../shared/types';
import { ICON_CLOSE, ICON_DIAMOND, ICON_SIGIL } from './icons';
import { Viz } from './viz';

export function initOverlay(): void {
  const overlay = document.querySelector<HTMLDivElement>('#overlay');
  const closeBtn = document.querySelector<HTMLButtonElement>('#overlay-close');
  const artHost = document.querySelector<HTMLDivElement>('#overlay-sigil');
  const titleEl = document.querySelector<HTMLHeadingElement>('#overlay-title');
  const mark = document.querySelector<HTMLDivElement>('#veil-mark');

  if (!overlay || !closeBtn || !artHost || !titleEl) return;
  closeBtn.innerHTML = ICON_CLOSE;
  if (mark) mark.innerHTML = ICON_DIAMOND;

  artHost.classList.add('clickable');
  artHost.title = 'Cycle focus: split → art → lyrics';
  titleEl.classList.add('clickable');
  titleEl.title = 'Cycle focus';

  const cycleFocus = (): void => {
    const artOnly = overlay.classList.toggle('art-focus');
    void artOnly;
  };

  artHost.addEventListener('click', cycleFocus);
  titleEl.addEventListener('click', cycleFocus);

  const transportHost = document.querySelector<HTMLDivElement>('#overlay-transport');
  if (transportHost) createTransport(transportHost);

  const vizCanvas = document.querySelector<HTMLCanvasElement>('#overlay-viz');
  if (vizCanvas !== null) new Viz(vizCanvas, overlay);

  const lyricsPane = document.getElementById('overlay-lyrics');
  let overlayLyrics: ReturnType<typeof createLyrics> | null = null;
  if (lyricsPane !== null) {
    overlayLyrics = createLyrics(lyricsPane, (state: LyricsState) => {
      overlay.classList.toggle('with-lyrics', state === 'synced' || state === 'plain');
      lyricsPane.hidden = !(state === 'synced' || state === 'plain');
    });
  }

  let current: IndexedTrack | null = null;

  const render = (): void => {
    if (current !== null && current.artFile !== null) {
      const img = document.createElement('img');
      img.className = 'overlay-img';
      img.alt = '';
      img.src = `media://local/${encodeURIComponent(current.artFile)}`;
      artHost.replaceChildren(img);
    } else {
      artHost.innerHTML = ICON_SIGIL;
    }
    titleEl.textContent = current !== null ? current.title : '';
  };

  appBus.on('track-selected', ({ track }) => {
    current = track;
    applyPalette(overlay, track.palette ?? fallbackPalette(track.id));
    applyLyricsInk(overlay, track.palette);
    overlayLyrics?.setTrack(track);
    render();
  });

  overlay.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (target !== null && target.closest('#overlay-close') !== null) {
        console.warn('[overlay] close via capture');
        closeNowPlaying();
      }
    },
    true,
  );

  closeBtn.addEventListener('click', () => {
    console.warn('[overlay] close button clicked');
    closeNowPlaying();
  });
}

export function isOverlayOpen(): boolean {
  const overlay = document.querySelector<HTMLDivElement>('#overlay');
  return overlay !== null && !overlay.hidden;
}

export function openNowPlaying(): void {
  setOverlay(true);
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
