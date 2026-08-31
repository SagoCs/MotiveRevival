import '../styles/queue.css';
import { el, fmtTime, createArtImage, thumbOf, paletteBedOf } from '../core/dom';
import { mediaUrl, player } from '../core/player';
import { ICON_CLOSE, ICON_SIGIL, ICON_STAR4 } from './icons';
import { attachContextMenu } from './playlistsView';
import type { IndexedTrack } from '../../shared/types';

const ICON_GRIP = `<svg viewBox="0 0 8 16" width="8" height="16" fill="currentColor" aria-hidden="true"><circle cx="2" cy="3" r="1"/><circle cx="6" cy="3" r="1"/><circle cx="2" cy="8" r="1"/><circle cx="6" cy="8" r="1"/><circle cx="2" cy="13" r="1"/><circle cx="6" cy="13" r="1"/></svg>`;

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

  const head = el('header', 'queue-head');
  const title = el('h3', 'queue-title');
  title.innerHTML = `${ICON_STAR4}<span>Up Next</span>`;
  const count = el('span', 'mono dim queue-count');
  count.textContent = '0';
  const closeBtn = el('button', 'icon-btn btn-small queue-close');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close queue');
  closeBtn.innerHTML = ICON_CLOSE;
  head.append(title, count, closeBtn);

  const list = el('ul', 'queue-list');
  panel.append(head, list);
  document.body.append(panel);

  let open = false;
  let dragFrom = -1;
  let dropGap = -1;
  let suppressClickUntil = 0;
  const stateListeners = new Set<(value: boolean) => void>();

  const rows = (): HTMLElement[] => Array.from(list.querySelectorAll<HTMLElement>('.queue-row'));

  const clearIndicators = (): void => {
    for (const row of rows()) row.classList.remove('q-ins-top', 'q-ins-bot');
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
    const grip = el('span', 'queue-grip');
    grip.innerHTML = ICON_GRIP;

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

    body.append(grip, thumb, meta, dur);
    swipe.append(hint, body);
    row.append(swipe);

    row.addEventListener('click', () => {
      if (Date.now() < suppressClickUntil) return;
      player.playUpcoming(offset);
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
          }
        }
        if (axis === 'x') {
          dx = mx;
          body.style.translate = `${dx}px 0`;
          body.style.opacity = String(Math.max(0.12, 1 - Math.abs(dx) / 110));
          hint.style.opacity = String(Math.min(1, Math.abs(dx) / 90));
          return;
        }
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.queue-row') ?? null;
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
        } else if (axis === 'y' && commit && dragFrom >= 0 && dropGap >= 0) {
          player.moveUpcoming(dragFrom, dropGap);
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
    const upcoming = player.getUpcoming();
    count.textContent = String(upcoming.length);
    list.replaceChildren();
    if (upcoming.length === 0) {
      const hint = el('li', 'queue-empty');
      hint.textContent = 'The queue rests — nothing ahead.';
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
  closeBtn.addEventListener('click', () => setOpen(false));

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
