import '../styles/queue.css';
import { el, fmtTime, createArtImage, thumbOf, paletteBedOf } from '../core/dom';
import { mediaUrl, player } from '../core/player';
import { ICON_CLOSE, ICON_SIGIL } from './icons';
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

  const head = el('header', 'queue-head');
  const title = el('h3', 'queue-title');
  title.textContent = 'Up Next';
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
    row.draggable = true;
    row.dataset.offset = String(offset);

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

    row.append(grip, thumb, meta, dur);

    row.addEventListener('dragstart', (e) => {
      dragFrom = offset;
      dropGap = -1;
      row.classList.add('q-dragging');
      if (e.dataTransfer !== null) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(offset));
      }
    });

    row.addEventListener('dragover', (e) => {
      if (dragFrom < 0) return;
      e.preventDefault();
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      dropGap = above ? offset : offset + 1;
      clearIndicators();
      row.classList.add(above ? 'q-ins-top' : 'q-ins-bot');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragFrom >= 0 && dropGap >= 0) player.moveUpcoming(dragFrom, dropGap);
      resetDrag();
    });

    row.addEventListener('dragend', () => resetDrag());

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      player.removeUpcoming(offset);
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

  const onListDrop = (e: DragEvent): void => {
    if (dragFrom < 0) return;
    e.preventDefault();
    player.moveUpcoming(dragFrom, player.getUpcoming().length);
    resetDrag();
  };
  list.addEventListener('dragover', (e) => {
    if (dragFrom < 0) return;
    e.preventDefault();
  });
  list.addEventListener('drop', onListDrop);

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
