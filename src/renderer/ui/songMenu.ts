import { libraryStore } from '../core/libraryStore';
import { mediaUrl, player } from '../core/player';
import { createArtImage, thumbOf } from '../core/dom';
import { playlistsStore } from '../core/playlistsStore';
import {
  createPlaylistWithTrack,
  fileIntoPlaylist,
  playlistContains,
  playlists,
  queueMoveToGap,
  queueNext,
  queueRemoveTrack,
  queueUpcoming,
  removePlaylist,
} from '../core/songActions';
import type { IndexedTrack, Playlist } from '../../shared/types';

type MenuPhase = 'fork' | 'queue' | 'playlists' | 'typing' | 'confirmDelete' | 'added';

const PANEL_WIDTH = 280;
const FADE_MS = 240;
const WORD_MS = 900;

let root: HTMLDivElement | null = null;
let listEl: HTMLDivElement | null = null;
let open = false;
let phase: MenuPhase = 'fork';
let in3d = false;
let track: IndexedTrack | null = null;
let highlightId: string | null = null;
let deleteTargetId: string | null = null;
let deletingId: string | null = null;
let closeTimer = 0;
let fadeTimer = 0;
let wired = false;

const trackArt = (t: IndexedTrack): HTMLImageElement | null => {
  if (t.artFile === null) return null;
  return createArtImage(mediaUrl(thumbOf(t.artFile)), { fallbackUrl: mediaUrl(t.artFile) });
};

const playlistArt = (pl: Playlist): HTMLImageElement | null => {
  const first = pl.tracks
    .map((ref) => libraryStore.getTrackList().find((t) => t.id === ref.trackId))
    .find((t) => t !== undefined && t.artFile !== null);
  if (first === undefined || first.artFile === null) return null;
  return createArtImage(mediaUrl(thumbOf(first.artFile)), { fallbackUrl: mediaUrl(first.artFile) });
};

const sm = (cls: string, text?: string): HTMLDivElement => {
  const node = document.createElement('div');
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const queueRow = (t: IndexedTrack, offset: number): HTMLDivElement => {
  const row = sm('sm-row');
  row.dataset.offset = String(offset);
  if (t.id === highlightId) row.classList.add('sm-new');

  const art = sm('sm-art');
  const img = trackArt(t);
  if (img !== null) art.append(img);
  else art.classList.add('sm-art-empty');

  const hit = sm('sm-hit');
  const name = sm('sm-name', t.title);
  hit.append(name);

  const x = sm('sm-x', '×');
  x.addEventListener('pointerdown', (e) => e.stopPropagation());
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    queueRemoveTrack(t.id);
  });

  row.append(art, hit, x);

  row.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    beginRowDrag(e, row, offset);
  });

  return row;
};

const drag = { active: false, fromOffset: -1, row: null as HTMLDivElement | null, gap: -1 };
let lineEl: HTMLDivElement | null = null;

const gapIndexAt = (clientY: number): number => {
  if (listEl === null) return -1;
  const rows = Array.from(listEl.querySelectorAll<HTMLDivElement>('.sm-row:not(.sm-dragging)'));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r === undefined) continue;
    const rect = r.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return rows.length;
};

const showLineAt = (gap: number): void => {
  if (listEl === null) return;
  if (lineEl === null) {
    lineEl = sm('sm-line');
    listEl.append(lineEl);
  }
  const rows = Array.from(listEl.querySelectorAll<HTMLDivElement>('.sm-row:not(.sm-dragging)'));
  if (gap >= rows.length) {
    const last = rows[rows.length - 1];
    if (last === undefined) {
      lineEl.remove();
      lineEl = null;
      return;
    }
    const rect = last.getBoundingClientRect();
    const host = listEl.getBoundingClientRect();
    lineEl.style.top = `${rect.bottom - host.top - 1}px`;
    return;
  }
  const row = rows[gap];
  if (row === undefined) return;
  const rect = row.getBoundingClientRect();
  const host = listEl.getBoundingClientRect();
  lineEl.style.top = `${rect.top - host.top - 1}px`;
};

const beginRowDrag = (event: PointerEvent, row: HTMLDivElement, offset: number): void => {
  drag.active = false;
  drag.fromOffset = offset;
  drag.row = row;
  const startY = event.clientY;

  const onMove = (move: PointerEvent): void => {
    if (!drag.active) {
      if (Math.abs(move.clientY - startY) < 5) return;
      drag.active = true;
      row.classList.add('sm-dragging');
    }
    const gap = gapIndexAt(move.clientY);
    if (gap !== drag.gap) {
      drag.gap = gap;
      showLineAt(gap);
    }
  };
  const finish = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    row.classList.remove('sm-dragging');
    if (lineEl !== null) {
      lineEl.remove();
      lineEl = null;
    }
    if (drag.active && drag.gap >= 0) {
      queueMoveToGap(drag.fromOffset, drag.gap);
    }
    drag.active = false;
    drag.gap = -1;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
};

const renderQueue = (): void => {
  if (root === null) return;
  root.classList.remove('sm-center');
  root.replaceChildren();
  const head = sm('sm-head', 'UP NEXT');
  const list = sm('sm-list');
  if (in3d) list.style.maxHeight = '';
  else list.style.maxHeight = `${Math.min(340, Math.max(180, window.innerHeight * 0.34))}px`;
  const upcoming = queueUpcoming();
  if (upcoming.length === 0) {
    list.append(sm('sm-empty', 'The queue is quiet.'));
  }
  upcoming.forEach((t, offset) => list.append(queueRow(t, offset)));
  listEl = list;
  root.append(head, list);
};

const renderFork = (): void => {
  if (root === null) return;
  root.classList.add('sm-center');
  root.replaceChildren();
  const queueBtn = sm('sm-fork-btn', 'Add to queue');
  const listBtn = sm('sm-fork-btn', 'Add to playlist');
  queueBtn.addEventListener('click', () => {
    if (track === null) return;
    queueNext(track);
    highlightId = track.id;
    phase = 'queue';
    renderQueue();
    requestHighlightPulse();
  });
  listBtn.addEventListener('click', () => {
    phase = 'playlists';
    renderPlaylists();
  });
  const fork = sm('sm-fork');
  fork.append(queueBtn, listBtn);
  root.append(fork);
};

const renderPlaylists = (): void => {
  if (root === null || track === null) return;
  const song = track;
  root.classList.remove('sm-center');
  root.replaceChildren();

  const head = sm('sm-head', 'ADD TO PLAYLIST');
  const list = sm('sm-list');

  const newRow = sm('sm-row sm-row-new');
  const plus = sm('sm-plus', '+');
  const hit = sm('sm-hit');
  hit.append(sm('sm-name', 'New playlist'));
  newRow.append(plus, hit);
  newRow.addEventListener('click', (e) => {
    e.preventDefault();
    phase = 'typing';
    renderTyping();
  });
  list.append(newRow);

  for (const pl of playlists()) {
    const row = sm('sm-row');
    const present = playlistContains(pl.id, song.id);

    const art = sm('sm-art');
    const img = playlistArt(pl);
    if (img !== null) art.append(img);
    else art.classList.add('sm-art-empty');

    const rowHit = sm('sm-hit');
    rowHit.append(sm('sm-name', pl.name));
    rowHit.append(sm('sm-count', `${pl.tracks.length}`));
    if (present) {
      row.classList.add('sm-muted');
      rowHit.append(sm('sm-added-mark', 'added'));
    }

    const x = sm('sm-x', '×');
    x.addEventListener('pointerdown', (e) => e.stopPropagation());
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      if (deleteTargetId !== null || deletingId !== null) return;
      deleteTargetId = pl.id;
      phase = 'confirmDelete';
      armConfirm(row, pl);
    });

    row.append(art, rowHit, x);
    if (!present) {
      rowHit.addEventListener('click', () => {
        void fileIntoPlaylist(pl.id, song).then(() => {
          phase = 'added';
          renderWord('Added');
        });
      });
    }
    list.append(row);
  }

  root.append(head, list);
};

const renderTyping = (): void => {
  if (root === null || track === null) return;
  const song = track;
  const list = root.querySelector('.sm-list');
  if (list === null) return;
  const newRow = list.querySelector('.sm-row-new');
  if (newRow === null) return;

  const typing = sm('sm-row sm-row-typing');
  const plus = sm('sm-plus', '+');
  const hit = sm('sm-hit');
  const input = document.createElement('input');
  input.className = 'sm-input';
  input.placeholder = 'Name it…';
  input.spellcheck = false;
  hit.append(input);
  typing.append(plus, hit);
  newRow.replaceWith(typing);
  requestAnimationFrame(() => input.focus());

  const commit = (): void => {
    const name = input.value.trim();
    if (name === '') return;
    void createPlaylistWithTrack(name, song).then(() => {
      phase = 'added';
      renderWord('Added');
    });
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      phase = 'playlists';
      renderPlaylists();
    }
  });
};

const fadeDeletedRow = (row: HTMLDivElement): void => {
  row.style.height = `${row.getBoundingClientRect().height}px`;
  row.classList.add('sm-deleted');
  row.replaceChildren(sm('sm-deleted-word', 'Deleted'));
  window.setTimeout(() => {
    row.classList.add('sm-gone');
    window.setTimeout(() => {
      deletingId = null;
      deleteTargetId = null;
      if (open && phase === 'playlists') renderPlaylists();
    }, 440);
  }, 560);
};

const armConfirm = (row: HTMLDivElement, pl: Playlist): void => {
  row.classList.add('sm-confirming');
  const pair = sm('sm-confirm-pair');
  const confirm = sm('sm-mini sm-mini-danger', 'Confirm');
  const cancel = sm('sm-mini', 'Cancel');
  confirm.addEventListener('click', (e) => {
    e.stopPropagation();
    if (deleteTargetId === null) return;
    const doomed = deleteTargetId;
    deleteTargetId = null;
    phase = 'playlists';
    deletingId = doomed;
    void removePlaylist(doomed).then(() => {
      fadeDeletedRow(row);
    });
  });
  cancel.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTargetId = null;
    phase = 'playlists';
    renderPlaylists();
  });
  pair.append(confirm, cancel);
  const x = row.querySelector('.sm-x');
  if (x !== null) x.replaceWith(pair);
};

const renderWord = (word: string): void => {
  if (root === null) return;
  root.classList.add('sm-center');
  root.replaceChildren();
  root.append(sm('sm-word', word));
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => {
    closeSongMenu();
  }, WORD_MS);
};

const requestHighlightPulse = (): void => {
  if (listEl === null) return;
  const row = listEl.querySelector('.sm-new');
  if (row === null) return;
  row.scrollIntoView({ block: 'nearest' });
};

const ensureWired = (): void => {
  if (wired) return;
  wired = true;

  player.bus.on('queueMutated', () => {
    if (open && phase === 'queue') {
      const keep = listEl?.scrollTop ?? 0;
      renderQueue();
      if (listEl !== null) listEl.scrollTop = keep;
    }
  });

  playlistsStore.onChange(() => {
    if (open && phase === 'playlists' && deletingId === null) renderPlaylists();
  });

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!open) return;
      if (root !== null && root.contains(e.target as Node)) return;
      if (
        e.button === 2 &&
        in3d &&
        root !== null &&
        root.parentElement !== null &&
        root.parentElement.contains(e.target as Node)
      ) {
        return;
      }
      closeSongMenu();
    },
    true,
  );

  window.addEventListener(
    'keydown',
    (e) => {
      if (!open || phase === 'typing') return;
      if (e.key !== 'Escape') return;
      if (deletingId !== null) return;
      e.preventDefault();
      e.stopPropagation();
      if (phase === 'confirmDelete') {
        deleteTargetId = null;
        phase = 'playlists';
        renderPlaylists();
        return;
      }
      if (phase === 'queue' || phase === 'playlists') {
        phase = 'fork';
        renderFork();
        return;
      }
      closeSongMenu();
    },
    true,
  );

  window.addEventListener(
    'wheel',
    (e) => {
      if (!open) return;
      if (root !== null && root.contains(e.target as Node)) {
        e.stopPropagation();
        return;
      }
      closeSongMenu();
    },
    { capture: true, passive: true },
  );
};

export function openSongMenu(opts: { track: IndexedTrack; host: HTMLElement | null; row: HTMLElement | null; phase?: 'fork' | 'queue' }): void {
  ensureWired();
  window.clearTimeout(closeTimer);
  window.clearTimeout(fadeTimer);
  if (open && opts.host !== null && root !== null && root.parentElement === opts.host) {
    closeSongMenu();
    return;
  }
  track = opts.track;
  highlightId = opts.track.id;
  deleteTargetId = null;
  in3d = opts.host !== null;

  if (root === null) {
    root = document.createElement('div');
    root.className = 'song-menu';
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }
  root.classList.remove('closing');
  root.classList.add(in3d ? 'song-menu-3d' : 'song-menu-chrome');
  root.classList.remove(in3d ? 'song-menu-chrome' : 'song-menu-3d');

  if (in3d && opts.host !== null) {
    root.style.left = '';
    root.style.top = '';
    opts.host.append(root);
  } else {
    document.body.append(root);
    const rect = opts.row?.getBoundingClientRect();
    if (rect !== undefined) {
      root.style.left = `${Math.min(rect.right + 10, window.innerWidth - PANEL_WIDTH - 12)}px`;
      root.style.top = `${Math.max(12, Math.min(rect.top, window.innerHeight - 160))}px`;
    }
  }

  open = true;
  phase = opts.phase ?? 'fork';
  if (phase === 'queue') renderQueue();
  else renderFork();
  requestAnimationFrame(() => root?.classList.add('on'));
}

export function closeSongMenu(): void {
  window.clearTimeout(closeTimer);
  if (!open && root === null) return;
  open = false;
  highlightId = null;
  const node = root;
  if (node === null) return;
  node.classList.remove('on');
  node.classList.add('closing');
  fadeTimer = window.setTimeout(() => {
    node.remove();
    node.classList.remove('closing');
  }, FADE_MS);
}

export function isSongMenuOpen(): boolean {
  return open;
}
