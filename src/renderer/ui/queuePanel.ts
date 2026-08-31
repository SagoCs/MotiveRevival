import '../styles/queue.css';
import { el, fmtTime, createArtImage, thumbOf, paletteBedOf } from '../core/dom';
import { mediaUrl, player } from '../core/player';
import { ICON_SIGIL, ICON_STAR4, ICON_STAR_HOLLOW } from './icons';
import { attachContextMenu } from './playlistsView';
import type { IndexedTrack } from '../../shared/types';

const ICON_CRESCENT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M16.8 3.9a8.5 8.5 0 1 0 3.3 15.7A9.1 9.1 0 0 1 16.8 3.9z"/></svg>`;

function createQueueDivider(header: boolean): HTMLDivElement {
  const divider = el('div', `queue-divider${header ? ' queue-divider-head' : ' queue-divider-row'}`);
  const left = el('span', 'queue-divider-rule');
  const right = el('span', 'queue-divider-rule');
  const motif = el('span', 'queue-divider-motif');
  if (header) {
    motif.innerHTML = `${ICON_CRESCENT}${ICON_STAR4}${ICON_CRESCENT}`;
  } else {
    motif.innerHTML = ICON_STAR4;
  }
  divider.append(left, motif, right);
  return divider;
}

function fmtQueueDuration(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes} MIN`;
  const hours = Math.floor(minutes / 60);
  return `${hours}H ${String(minutes % 60).padStart(2, '0')}M`;
}

export interface QueuePanelHandle {
  toggle(): boolean;
  close(): void;
  isOpen(): boolean;
  onStateChange(cb: (open: boolean) => void): () => void;
}

let sharedHandle: QueuePanelHandle | null = null;

export function createQueuePanel(): QueuePanelHandle {
  if (sharedHandle !== null) return sharedHandle;

  const panel = el('aside');
  panel.id = 'queue-panel';
  panel.classList.add('plate');

  const nowHead = el('header', 'queue-now-head');
  const nowTitle = el('h3', 'queue-title queue-now-title');
  nowTitle.innerHTML = `${ICON_STAR4}<span>Now Playing</span>`;
  const queueSummary = el('span', 'dim queue-summary');
  nowHead.append(nowTitle, queueSummary);
  const nowBody = el('div', 'queue-now-body q-body');
  const headDivider = createQueueDivider(true);

  const list = el('ul', 'queue-list');
  panel.append(nowHead, nowBody, headDivider, list);
  document.body.append(panel);

  let open = false;
  let dragFrom = -1;
  let dropGap = -1;
  let suppressClickUntil = 0;
  const stateListeners = new Set<(value: boolean) => void>();

  const rows = (): HTMLElement[] => Array.from(list.querySelectorAll<HTMLElement>('.queue-row'));

  const clearIndicators = (): void => {
    for (const row of rows()) row.classList.remove('q-ins-top', 'q-ins-bot');
    nowBody.classList.remove('q-now-drop');
  };

  const resetDrag = (): void => {
    dragFrom = -1;
    dropGap = -1;
    for (const row of rows()) row.classList.remove('q-dragging', 'q-ins-top', 'q-ins-bot');
  };

  const buildRow = (track: IndexedTrack, offset: number): HTMLLIElement => {
    const row = el('li', 'queue-row');
    row.dataset.offset = String(offset);

    const swipe = el('span', 'q-swipe');
    const hint = el('span', 'q-swipe-hint');
    hint.textContent = 'Remove from queue';

    const body = el('span', 'q-body');

    const thumb = el('span', 'queue-thumb');
    if (track.artFile !== null) {
      thumb.style.background = paletteBedOf(track.palette, track.id);
      thumb.append(createArtImage(mediaUrl(thumbOf(track.artFile)), { fallbackUrl: mediaUrl(track.artFile) }));
    } else {
      const sigil = el('span', 'queue-sigil');
      sigil.innerHTML = ICON_SIGIL;
      thumb.append(sigil);
    }

    const meta = el('span', 'queue-meta');
    const name = el('span', 'queue-name');
    name.textContent = track.title;
    const artist = el('span', 'dim queue-artist');
    artist.textContent = track.artist ?? 'Unknown artist';
    meta.append(name, artist);

    const dur = el('span', 'mono dim queue-dur');
    dur.textContent = fmtTime(track.durationSec ?? 0);

    body.append(thumb, meta, dur);
    swipe.append(hint, body);
    if (offset > 0) row.append(createQueueDivider(false));
    row.append(swipe);

    let dragPreview: HTMLDivElement | null = null;
    const updateDragPreview = (x: number, y: number): void => {
      if (dragPreview === null) return;
      const width = 232;
      const left = Math.min(x + 16, Math.max(12, window.innerWidth - width - 12));
      const top = Math.min(Math.max(12, y - 26), Math.max(12, window.innerHeight - 76));
      dragPreview.style.left = `${left}px`;
      dragPreview.style.top = `${top}px`;
    };
    const showDragPreview = (x: number, y: number): void => {
      if (dragPreview !== null) return;
      dragPreview = el('div', 'queue-drag-preview');
      const previewThumb = el('span', 'queue-drag-thumb');
      previewThumb.style.background = paletteBedOf(track.palette, track.id);
      if (track.artFile !== null) {
        previewThumb.append(createArtImage(mediaUrl(thumbOf(track.artFile)), { fallbackUrl: mediaUrl(track.artFile) }));
      } else {
        const previewSigil = el('span', 'queue-sigil');
        previewSigil.innerHTML = ICON_SIGIL;
        previewThumb.append(previewSigil);
      }
      const previewMeta = el('span', 'queue-drag-meta');
      const previewName = el('span', 'queue-drag-name');
      previewName.textContent = track.title;
      const previewArtist = el('span', 'dim queue-drag-artist');
      previewArtist.textContent = track.artist ?? 'Unknown artist';
      previewMeta.append(previewName, previewArtist);
      dragPreview.append(previewThumb, previewMeta);
      document.body.append(dragPreview);
      updateDragPreview(x, y);
    };
    const hideDragPreview = (): void => {
      dragPreview?.remove();
      dragPreview = null;
    };

    row.addEventListener('click', () => {
      if (Date.now() < suppressClickUntil) return;
      player.playUpcomingNow(offset);
    });

    attachContextMenu(row, track, undefined, undefined, [
      { label: 'Remove from queue', action: () => player.removeUpcoming(offset) },
    ]);

    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let axis: 'x' | 'y' | null = null;
      let dx = 0;
      const rowWidth = Math.max(140, row.offsetWidth);
      try {
        row.setPointerCapture(e.pointerId);
      } catch {
        return;
      }
      function onMove(ev: PointerEvent): void {
        const mx = ev.clientX - startX;
        const my = ev.clientY - startY;
        if (axis === null) {
          if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
          axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
          if (axis === 'y') {
            dragFrom = offset;
            row.classList.add('q-dragging');
            showDragPreview(ev.clientX, ev.clientY);
          }
        }
        if (axis === 'x') {
          dx = mx;
          body.style.translate = `${dx}px 0`;
          body.style.opacity = String(Math.max(0.12, 1 - Math.abs(dx) / 110));
          hint.style.opacity = String(Math.min(1, Math.abs(dx) / 90));
          return;
        }
        updateDragPreview(ev.clientX, ev.clientY);
        const pointTarget = document.elementFromPoint(ev.clientX, ev.clientY);
        if (pointTarget?.closest('.queue-now-body') !== null) {
          clearIndicators();
          dropGap = -2;
          nowBody.classList.add('q-now-drop');
          return;
        }
        const target = pointTarget?.closest<HTMLElement>('.queue-row') ?? null;
        clearIndicators();
        if (target === null || target === row) {
          dropGap = -1;
          return;
        }
        const idx = rows().indexOf(target);
        if (idx < 0) {
          dropGap = -1;
          return;
        }
        const rect = target.getBoundingClientRect();
        const above = ev.clientY < rect.top + rect.height / 2;
        dropGap = above ? idx : idx + 1;
        target.classList.add(above ? 'q-ins-top' : 'q-ins-bot');
      }
      function finish(commit: boolean): void {
        row.removeEventListener('pointermove', onMove);
        row.removeEventListener('pointerup', onUp);
        row.removeEventListener('pointercancel', onCancel);
        hideDragPreview();
        if (axis !== null) suppressClickUntil = Date.now() + 350;
        if (axis === 'x') {
          if (commit && Math.abs(dx) > rowWidth * 0.33) {
            row.classList.add('q-swipe-out');
            body.style.translate = `${dx > 0 ? 130 : -130}% 0`;
            body.style.opacity = '0';
            window.setTimeout(() => player.removeUpcoming(offset), 170);
          } else {
            row.classList.add('q-spring');
            body.style.translate = '0 0';
            body.style.opacity = '1';
            hint.style.opacity = '0';
            window.setTimeout(() => row.classList.remove('q-spring'), 260);
          }
        } else if (axis === 'y' && commit && dragFrom >= 0) {
          if (dropGap === -2) player.playUpcomingNow(dragFrom);
          else if (dropGap >= 0) player.moveUpcoming(dragFrom, dropGap);
        }
        resetDrag();
      }
      function onUp(): void {
        finish(true);
      }
      function onCancel(): void {
        finish(false);
      }
      row.addEventListener('pointermove', onMove);
      row.addEventListener('pointerup', onUp);
      row.addEventListener('pointercancel', onCancel);
    });

    return row;
  };

  const render = (): void => {
    nowBody.replaceChildren();
    const current = player.currentTrack;
    if (current !== null) {
      const nowThumb = el('span', 'queue-thumb');
      nowThumb.style.background = paletteBedOf(current.palette, current.id);
      if (current.artFile !== null) {
        nowThumb.append(createArtImage(mediaUrl(thumbOf(current.artFile)), { fallbackUrl: mediaUrl(current.artFile) }));
      } else {
        const nowSigil = el('span', 'queue-sigil');
        nowSigil.innerHTML = ICON_SIGIL;
        nowThumb.append(nowSigil);
      }
      const nowMeta = el('span', 'queue-meta');
      const nowName = el('span', 'queue-name');
      nowName.textContent = current.title;
      const nowArtist = el('span', 'dim queue-artist');
      nowArtist.textContent = current.artist ?? 'Unknown artist';
      const nowDur = el('span', 'mono dim queue-dur');
      nowDur.textContent = fmtTime(current.durationSec ?? 0);
      nowMeta.append(nowName, nowArtist);
      nowBody.append(nowThumb, nowMeta, nowDur);
    } else {
      const nowEmpty = el('span', 'dim queue-now-empty');
      nowEmpty.textContent = 'Nothing is playing';
      nowBody.append(nowEmpty);
    }
    const upcoming = player.getUpcoming();
    const queueDuration = upcoming.reduce((total, track) => total + (track.durationSec ?? 0), 0);
    queueSummary.textContent = `${upcoming.length} SONGS · ${fmtQueueDuration(queueDuration)}`;
    list.replaceChildren();
    if (upcoming.length === 0) {
      const hint = el('li', 'queue-empty');
      const sigil = el('span', 'queue-empty-sigil');
      sigil.innerHTML = ICON_STAR_HOLLOW;
      hint.textContent = 'The queue rests — nothing ahead.';
      hint.prepend(sigil);
      list.append(hint);
      return;
    }
    upcoming.forEach((track, offset) => list.append(buildRow(track, offset)));
  };

  const setOpen = (value: boolean): void => {
    open = value;
    panel.classList.toggle('open', open);
    if (!open) resetDrag();
    else render();
    for (const listener of stateListeners) listener(open);
  };

  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') setOpen(false);
  });
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!open) return;
      const hit = e.target as HTMLElement | null;
      if (hit?.closest('#queue-panel, .queue-toggle') !== null) return;
      setOpen(false);
    },
    true,
  );

  player.bus.on('queueMutated', () => {
    if (open) render();
  });
  player.bus.on('trackChanged', () => {
    if (open) render();
  });

  sharedHandle = {
    toggle: () => {
      setOpen(!open);
      return open;
    },
    close: () => setOpen(false),
    isOpen: () => open,
    onStateChange: (cb) => {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
  };
  return sharedHandle;
}
