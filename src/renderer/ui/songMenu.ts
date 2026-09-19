import { appBus } from '../core/appBus';
import { removePlaylistTrack, queueAppend } from '../core/songActions';
import type { IndexedTrack } from '../../shared/types';

type MenuPhase = 'fork' | 'added';

const PANEL_WIDTH = 280;
const FADE_MS = 240;
const WORD_MS = 900;

let root: HTMLDivElement | null = null;
let open = false;
let phase: MenuPhase = 'fork';
let in3d = false;
let track: IndexedTrack | null = null;
let playlistContext: { id: string; index: number } | null = null;
let chromeRow: HTMLElement | null = null;
let toggleAnchor: HTMLElement | null = null;
let closeTimer = 0;
let fadeTimer = 0;
let wired = false;

const sm = (cls: string, text?: string): HTMLDivElement => {
  const node = document.createElement('div');
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const renderFork = (): void => {
  if (root === null) return;
  root.classList.add('sm-center');
  root.replaceChildren();
  const queueBtn = sm('sm-fork-btn', 'Add to queue');
  const inPlaylist = playlistContext !== null;
  const listBtn = sm('sm-fork-btn', inPlaylist ? 'Remove from playlist' : 'Add to playlist');
  queueBtn.addEventListener('click', () => {
    if (track === null) return;
    const outcome = queueAppend(track);
    phase = 'added';
    renderWord(outcome === 'already' ? 'Already there' : 'Added');
  });
  listBtn.addEventListener('click', () => {
    if (inPlaylist && playlistContext !== null) {
      const target = playlistContext;
      closeSongMenu();
      void removePlaylistTrack(target.id, target.index);
      return;
    }
    if (track === null) return;
    const song = track;
    closeSongMenu();
    appBus.emit('summon-close', {});
    appBus.emit('file-requested', { track: song });
  });
  const fork = sm('sm-fork');
  fork.append(queueBtn, listBtn);
  root.append(fork);
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

const ensureWired = (): void => {
  if (wired) return;
  wired = true;

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!open) return;
      if (
        root !== null &&
        root.contains(e.target as Node)
      ) {
        return;
      }
      if (toggleAnchor !== null && toggleAnchor.contains(e.target as Node)) {
        return;
      }
      if (
        e.button === 2 &&
        root !== null &&
        root.parentElement !== null &&
        ((in3d && root.parentElement.contains(e.target as Node)) ||
          (!in3d && chromeRow !== null && chromeRow.contains(e.target as Node)))
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
      if (!open) return;
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
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

export function openSongMenu(opts: {
  track?: IndexedTrack | null;
  host: HTMLElement | null;
  row: HTMLElement | null;
  placement?: 'right' | 'above';
  toggle?: boolean;
  playlist?: { id: string; index: number };
}): void {
  ensureWired();
  window.clearTimeout(closeTimer);
  window.clearTimeout(fadeTimer);
  const sameHost = opts.host !== null && root !== null && root.parentElement === opts.host;
  const sameRow = opts.host === null && opts.row !== null && chromeRow === opts.row;
  if (open && (sameHost || sameRow)) {
    closeSongMenu();
    return;
  }
  track = opts.track ?? null;
  playlistContext = opts.playlist ?? null;
  chromeRow = opts.host === null ? opts.row : null;
  toggleAnchor = opts.toggle === true ? chromeRow : null;
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
    root.style.bottom = '';
    opts.host.append(root);
  } else {
    document.body.append(root);
    const rect = opts.row?.getBoundingClientRect();
    if (rect !== undefined && opts.placement === 'above') {
      const centered = rect.left + rect.width / 2 - PANEL_WIDTH / 2;
      root.style.left = `${Math.max(12, Math.min(centered, window.innerWidth - PANEL_WIDTH - 12))}px`;
      root.style.top = '';
      root.style.bottom = `${Math.max(70, window.innerHeight - rect.top + 10)}px`;
    } else if (rect !== undefined) {
      root.style.left = `${Math.max(12, Math.min(rect.right + 10, window.innerWidth - PANEL_WIDTH - 12))}px`;
      root.style.top = `${Math.max(12, Math.min(rect.top, window.innerHeight - 160))}px`;
      root.style.bottom = '';
    } else {
      root.style.left = `${Math.max(12, Math.round((window.innerWidth - PANEL_WIDTH) / 2))}px`;
      root.style.top = `${Math.round(window.innerHeight * 0.3)}px`;
      root.style.bottom = '';
    }
  }

  open = true;
  phase = 'fork';
  renderFork();
  requestAnimationFrame(() => root?.classList.add('on'));
  appBus.emit('song-menu-opened', { row: chromeRow });
}

export function closeSongMenu(): void {
  window.clearTimeout(closeTimer);
  const wasOpen = open;
  if (!open && root === null) return;
  open = false;
  if (wasOpen) appBus.emit('song-menu-closed', {});
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

export function attachSongMenu(row: HTMLElement, track: IndexedTrack): void {
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openSongMenu({ track, host: null, row });
  });
}
