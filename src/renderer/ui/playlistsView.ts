import { el, fmtTime, createArtImage, thumbOf, paletteBedOf } from '../core/dom';
import { mediaUrl, player } from '../core/player';
import { preview } from '../core/preview';
import { applyPalette, fallbackPalette } from '../core/palette';
import { fmtTotal } from '../core/searchIndex';
import { fuzzyScore } from '../core/fuzzy';
import { basenameOf } from '../core/paths';
import { ICON_SIGIL, ICON_PLAY, ICON_SHUFFLE, ICON_TRASH } from './icons';
import { playlistsStore, type ResolvedPlaylistEntry } from '../core/playlistsStore';
import type { IndexedTrack, Playlist, PlaylistTrackRef } from '../../shared/types';

const ICON_PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" width="26" height="26" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;

const UNKNOWN_ARTIST = 'Unknown Artist';

export interface PlaylistSearchHit {
  playlist: Playlist;
  score: number;
}

let layer: HTMLElement | null = null;
let nameInput: HTMLInputElement | null = null;
let metaEl: HTMLElement | null = null;
let playBtn: HTMLButtonElement | null = null;
let shuffleBtn: HTMLButtonElement | null = null;
let deleteBtn: HTMLButtonElement | null = null;
let listEl: HTMLOListElement | null = null;
let emptyEl: HTMLElement | null = null;
let openId: string | null = null;
let confirmArmed = false;
let confirmTimer = 0;
let booted = false;
let dragIndex = -1;
let dropGap = -1;

export function initPlaylists(): void {
  if (booted) return;
  booted = true;

  layer = buildLayer();
  document.body.append(layer);

  playlistsStore.onChange((playlists) => {
    if (openId !== null) {
      if (!playlists.some((p) => p.id === openId)) {
        closePlaylistLayer();
        return;
      }
      renderPanel();
      return;
    }
    syncTabRegion();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    if (isTopLayerBlocked()) return;
    e.preventDefault();
    closePlaylistLayer();
  });

  void playlistsStore.load();
}

function buildLayer(): HTMLElement {
  const section = el('section', '');
  section.id = 'playlist-layer';
  section.hidden = true;
  section.setAttribute('aria-label', 'Playlist detail');

  const inner = el('div', 'playlist-inner');
  const head = el('header', 'playlist-head');

  nameInput = el('input', 'playlist-name');
  nameInput.type = 'text';
  nameInput.spellcheck = false;
  nameInput.autocomplete = 'off';
  nameInput.maxLength = 80;
  nameInput.setAttribute('aria-label', 'Playlist name');
  nameInput.addEventListener('change', () => {
    if (openId === null || nameInput === null) return;
    void playlistsStore.rename(openId, nameInput.value);
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameInput?.blur();
    }
  });

  metaEl = el('div', 'mono dim playlist-meta');

  const actions = el('div', 'playlist-actions');
  playBtn = el('button', 'ghost-btn ghost-mini');
  playBtn.type = 'button';
  playBtn.classList.add('playlist-icon-action');
  playBtn.innerHTML = ICON_PLAY;
  playBtn.setAttribute('aria-label', 'Play all');
  playBtn.title = 'Play all';
  playBtn.addEventListener('click', () => playAll());
  shuffleBtn = el('button', 'ghost-btn ghost-mini');
  shuffleBtn.type = 'button';
  shuffleBtn.classList.add('playlist-icon-action');
  shuffleBtn.innerHTML = ICON_SHUFFLE;
  shuffleBtn.setAttribute('aria-label', 'Shuffle playlist');
  shuffleBtn.title = 'Shuffle playlist';
  shuffleBtn.addEventListener('click', () => shuffleAll());
  deleteBtn = el('button', 'ghost-btn ghost-mini playlist-danger');
  deleteBtn.type = 'button';
  deleteBtn.classList.add('playlist-icon-action');
  deleteBtn.innerHTML = ICON_TRASH;
  deleteBtn.setAttribute('aria-label', 'Delete playlist');
  deleteBtn.title = 'Delete playlist';
  deleteBtn.addEventListener('click', () => onDelete());
  actions.append(shuffleBtn, playBtn, deleteBtn);

  const headText = el('div', 'playlist-head-text');
  headText.append(nameInput, metaEl);
  head.append(headText, actions);

  listEl = el('ol', 'playlist-list');

  emptyEl = el('div', 'playlist-empty dim');
  emptyEl.textContent = 'Empty sequence — summon songs into it from the archive.';
  emptyEl.hidden = true;

  inner.append(head, listEl, emptyEl);
  section.append(inner);
  return section;
}

function isOpen(): boolean {
  return openId !== null && layer !== null && layer.classList.contains('open') && !layer.hidden;
}

function isTopLayerBlocked(): boolean {
  const oracleOpen =
    document.querySelector('#search-oracle')?.classList.contains('open') === true;
  const settingsOpen =
    document.querySelector('#settings-modal')?.classList.contains('open') === true;
  const detailOpen =
    document.querySelector('#detail-layer')?.classList.contains('open') === true;
  const overlayOpen = document.querySelector('#overlay')?.classList.contains('open') === true;
  return oracleOpen || settingsOpen || detailOpen || overlayOpen;
}

export function openDetail(playlistId: string): void {
  initPlaylists();
  if (layer === null) return;
  if (playlistsStore.get(playlistId) === null) return;
  openId = playlistId;
  disarmConfirm();
  renderPanel();
  layer.hidden = false;
  requestAnimationFrame(() => layer?.classList.add('open'));
}

export function closePlaylistLayer(): void {
  openId = null;
  disarmConfirm();
  if (layer === null) return;
  layer.classList.remove('open');
  window.setTimeout(() => {
    if (openId === null && layer !== null) layer.hidden = true;
  }, 460);
}

export function isPlaylistLayerOpen(): boolean {
  return isOpen();
}

export function searchPlaylists(query: string): PlaylistSearchHit[] {
  initPlaylists();
  const hits: PlaylistSearchHit[] = [];
  for (const pl of playlistsStore.list()) {
    const score = fuzzyScore(query, pl.name);
    if (score !== null) hits.push({ playlist: pl, score });
  }
  hits.sort(
    (a, b) => b.score - a.score || a.playlist.name.localeCompare(b.playlist.name),
  );
  return hits;
}

export function renderTabCards(frag: DocumentFragment): void {
  initPlaylists();
  frag.append(newCard());
  for (const pl of playlistsStore.list()) frag.append(card(pl));
}

function syncTabRegion(): void {
  const anchor = document.querySelector('.playlist-card.new-card');
  const parent = anchor?.parentElement ?? null;
  if (anchor === null || parent === null) return;
  for (const node of Array.from(parent.querySelectorAll('.playlist-card:not(.new-card)'))) {
    node.remove();
  }
  let cursor: Element | null = anchor;
  for (const pl of playlistsStore.list()) {
    const node = card(pl);
    cursor.insertAdjacentElement('afterend', node);
    cursor = node;
  }
}

function card(pl: Playlist): HTMLElement {
  const node = el('div', 'card playlist-card');
  node.dataset.interactive = '1';

  const resolved = playlistsStore.resolve(pl.tracks);
  const live = liveOf(resolved);

  const palette = live.find((t) => t.palette !== null)?.palette ?? fallbackPalette(pl.id);
  applyPalette(node, palette);

  const cover = el('div', 'playlist-cover');
  artInto(cover, live[0] ?? null);

  const text = el('div', 'playlist-card-text');
  const title = el('div', 'card-title');
  title.textContent = pl.name;
  const sub = el('div', 'mono dim card-sub');
  sub.textContent = `${resolved.length} track${resolved.length === 1 ? '' : 's'} · ${fmtTotal(sumDuration(live))}`;
  text.append(title, sub);

  node.append(cover, text);
  attachTap(node, () => openDetail(pl.id));
  return node;
}

function newCard(): HTMLElement {
  const node = el('div', 'card playlist-card new-card');
  node.dataset.interactive = '1';

  const cover = el('div', 'playlist-cover new-cover');
  cover.innerHTML = ICON_PLUS;

  const text = el('div', 'playlist-card-text');
  const title = el('div', 'card-title');
  title.textContent = 'New Playlist';
  const sub = el('div', 'mono dim card-sub');
  sub.textContent = 'Weave a sequence of songs';
  text.append(title, sub);

  node.append(cover, text);
  attachTap(node, () => beginCreate(node));
  return node;
}

function beginCreate(node: HTMLElement): void {
  const slot = node.querySelector<HTMLElement>('.playlist-card-text');
  if (slot === null || slot.querySelector('input') !== null) return;

  const saved = Array.from(slot.childNodes);
  const input = document.createElement('input');
  input.className = 'new-playlist-input';
  input.type = 'text';
  input.placeholder = 'Name this playlist…';
  input.maxLength = 80;
  input.spellcheck = false;
  input.setAttribute('aria-label', 'New playlist name');
  slot.replaceChildren(input);
  requestAnimationFrame(() => input.focus());

  let done = false;
  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    input.removeEventListener('blur', onBlur);
    input.removeEventListener('keydown', onKey);
    slot.replaceChildren(...saved);
    if (!commit || name === '') return;
    void playlistsStore.create(name).then((pl) => {
      syncTabRegion();
      openDetail(pl.id);
    });
  };
  const onBlur = (): void => finish(true);
  const onKey = (e: KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  };
  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', onKey);
}

function renderPanel(): void {
  if (layer === null || openId === null) return;
  const pl = playlistsStore.get(openId);
  if (pl === null) {
    closePlaylistLayer();
    return;
  }

  const resolved = playlistsStore.resolve(pl.tracks);
  const live = liveOf(resolved);

  if (nameInput !== null && document.activeElement !== nameInput) nameInput.value = pl.name;
  if (metaEl !== null) {
    metaEl.textContent = `${resolved.length} track${resolved.length === 1 ? '' : 's'} · ${fmtTotal(sumDuration(live))}`;
  }

  if (listEl !== null) {
    listEl.replaceChildren();
    const frag = document.createDocumentFragment();
    resolved.forEach((entry, i) => frag.append(rowNode(entry, i, pl.id)));
    listEl.append(frag);
  }
  if (emptyEl !== null) emptyEl.hidden = resolved.length !== 0;
  if (playBtn !== null) playBtn.disabled = live.length === 0;
  if (shuffleBtn !== null) shuffleBtn.disabled = live.length === 0;
}

function resetPlaylistDrag(): void {
  dragIndex = -1;
  dropGap = -1;
  for (const row of document.querySelectorAll<HTMLElement>('.playlist-row')) {
    row.classList.remove('playlist-dragging', 'playlist-ins-top', 'playlist-ins-bot');
  }
}

function clearPlaylistIndicators(): void {
  for (const row of document.querySelectorAll<HTMLElement>('.playlist-row')) {
    row.classList.remove('playlist-ins-top', 'playlist-ins-bot');
  }
}

function rowNode(
  entry: ResolvedPlaylistEntry,
  index: number,
  playlistId: string,
): HTMLElement {
  const cell = el('li', 'mini-cell playlist-row');
  cell.style.animationDelay = `${Math.min(index * 18, 240)}ms`;
  cell.draggable = true;

  cell.addEventListener('dragstart', (e) => {
    dragIndex = index;
    dropGap = -1;
    cell.classList.add('playlist-dragging');
    if (e.dataTransfer !== null) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  });
  cell.addEventListener('dragover', (e) => {
    if (dragIndex < 0) return;
    e.preventDefault();
    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'move';
    const above = e.clientY < cell.getBoundingClientRect().top + cell.offsetHeight / 2;
    dropGap = above ? index : index + 1;
    clearPlaylistIndicators();
    cell.classList.add(above ? 'playlist-ins-top' : 'playlist-ins-bot');
  });
  cell.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragIndex >= 0 && dropGap >= 0) {
      void playlistsStore.reorderTrack(playlistId, dragIndex, dropGap);
    }
    resetPlaylistDrag();
  });
  cell.addEventListener('dragend', () => resetPlaylistDrag());

  const n = el('span', 'mono det-index');
  n.textContent = String(index + 1).padStart(2, '0');

  const thumb = el('div', 'mini-thumb');
  const title = el('span', 'det-title');
  const sub = el('span', 'mono dim playlist-row-sub');
  const dur = el('span', 'mono dim det-dur');

  if ('track' in entry) {
    cell.dataset.trackId = entry.track.id;
    artInto(thumb, entry.track);
    title.textContent = entry.track.title;
    sub.textContent =
      `${entry.track.artist ?? UNKNOWN_ARTIST}${entry.track.album !== null ? ` — ${entry.track.album}` : ''}`;
    dur.textContent =
      entry.track.durationSec !== null && Number.isFinite(entry.track.durationSec)
        ? fmtTime(entry.track.durationSec)
        : '--:--';
    attachTap(cell, () => playRow(entry.track, playlistId, thumb));
  } else {
    cell.classList.add('ghost');
    thumb.classList.add('noart');
    thumb.innerHTML = ICON_SIGIL;
    title.textContent = basenameOf(entry.ref.absPath);
    sub.textContent = entry.ref.absPath;
    dur.textContent = '--:--';
  }

  const text = el('div', 'playlist-row-text');
  text.append(title, sub);

  const actions = el('div', 'playlist-row-actions');
  const rm = actButton('\u2715', 'Remove from playlist');
  rm.addEventListener('click', (e) => {
    e.stopPropagation();
    void playlistsStore.removeTrack(playlistId, index);
  });
  actions.append(rm);

  cell.append(n, thumb, text, dur, actions);
  return cell;
}

function actButton(glyph: string, label: string): HTMLButtonElement {
  const b = el('button', 'mini-act');
  b.type = 'button';
  b.textContent = glyph;
  b.title = label;
  b.setAttribute('aria-label', label);
  return b;
}

function playRow(track: IndexedTrack, playlistId: string, thumb: HTMLElement): void {
  const pl = playlistsStore.get(playlistId);
  if (pl === null) return;
  const live = playlistsStore.liveTracks(pl.tracks);
  const idx = live.findIndex((t) => t.id === track.id);
  preview.hardStop();
  if (idx >= 0) player.setContext(live, idx);
  else player.setContext([track], 0);
}

function playAll(): void {
  if (openId === null) return;
  const pl = playlistsStore.get(openId);
  if (pl === null) return;
  const live = playlistsStore.liveTracks(pl.tracks);
  if (live.length === 0) return;
  preview.hardStop();
  player.setContext(live, 0);
}

function shuffleAll(): void {
  if (openId === null) return;
  const pl = playlistsStore.get(openId);
  if (pl === null) return;
  const live = playlistsStore.liveTracks(pl.tracks);
  if (live.length === 0) return;
  const shuffled = [...live];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = shuffled[i];
    const picked = shuffled[j];
    if (current === undefined || picked === undefined) continue;
    shuffled[i] = picked;
    shuffled[j] = current;
  }
  preview.hardStop();
  player.setContext(shuffled, 0);
}

function onDelete(): void {
  if (deleteBtn === null) return;
  if (!confirmArmed) {
    confirmArmed = true;
    deleteBtn.classList.add('confirm');
    deleteBtn.innerHTML = ICON_TRASH;
    deleteBtn.setAttribute('aria-label', 'Confirm delete playlist');
    deleteBtn.title = 'Confirm delete playlist';
    confirmTimer = window.setTimeout(disarmConfirm, 3000);
    return;
  }
  disarmConfirm();
  const id = openId;
  closePlaylistLayer();
  if (id !== null) void playlistsStore.remove(id);
}

function disarmConfirm(): void {
  confirmArmed = false;
  window.clearTimeout(confirmTimer);
  if (deleteBtn !== null) {
    deleteBtn.classList.remove('confirm');
    deleteBtn.innerHTML = ICON_TRASH;
    deleteBtn.setAttribute('aria-label', 'Delete playlist');
    deleteBtn.title = 'Delete playlist';
  }
}

function liveOf(resolved: readonly ResolvedPlaylistEntry[]): IndexedTrack[] {
  const out: IndexedTrack[] = [];
  for (const entry of resolved) {
    if ('track' in entry) out.push(entry.track);
  }
  return out;
}

function sumDuration(tracks: readonly IndexedTrack[]): number {
  let total = 0;
  for (const t of tracks) {
    if (t.durationSec !== null && Number.isFinite(t.durationSec)) total += t.durationSec;
  }
  return total;
}

function artInto(host: HTMLElement, track: IndexedTrack | null): void {
  if (track !== null && track.artFile !== null) {
    host.style.background = paletteBedOf(track.palette, track.id);
    const img = createArtImage(mediaUrl(thumbOf(track.artFile)), { fallbackUrl: mediaUrl(track.artFile) });
    img.className = 'card-img';
    host.replaceChildren(img);
    host.classList.remove('noart');
  } else {
    host.classList.add('noart');
    host.innerHTML = ICON_SIGIL;
  }
}

function attachTap(node: HTMLElement, action: () => void): void {
  let x = 0;
  let y = 0;
  node.addEventListener('pointerdown', (e) => {
    x = e.clientX;
    y = e.clientY;
  });
  node.addEventListener('click', (e) => {
    if (Math.hypot(e.clientX - x, e.clientY - y) > 10) return;
    action();
  });
}

let menu: HTMLElement | null = null;
let outsideBound = false;

export function attachContextMenu(
  row: HTMLElement,
  track: IndexedTrack,
  onPlay?: () => void,
  onGoToAlbum?: () => void,
): void {
  initPlaylists();
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(row, track, onPlay, onGoToAlbum, e.clientY);
  });
}

function openContextMenu(
  row: HTMLElement,
  track: IndexedTrack,
  onPlay: (() => void) | undefined,
  onGoToAlbum: (() => void) | undefined,
  cursorY: number,
): void {
  closeMenu(true);
  ensureOutsideBound();

  const rowRect = row.getBoundingClientRect();
  let menuPosition: { x: number; y: number } | null = null;

  const card = el('div', 'ctx-menu');
  card.dataset.interactive = '1';
  card.addEventListener('click', (e) => e.stopPropagation());
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  card.addEventListener('keydown', (e) => e.stopPropagation());

  const renderRootMenu = (): void => {
    const view = el('div', 'ctx-view');

    const addItem = menuItem('Add to playlist', '\u25B8');
    addItem.addEventListener('click', (e) => {
      e.stopPropagation();
      renderPlaylistListView();
    });

    const playItem = menuItem('Play now', null);
    playItem.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu(true);
      if (onPlay !== undefined) onPlay();
    });

    const albumItem = menuItem('Go to album', null);
    albumItem.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu(true);
      if (onGoToAlbum !== undefined) onGoToAlbum();
      else {
        window.dispatchEvent(
          new CustomEvent('mr-go-to-album', { detail: { absPath: track.absPath } }),
        );
      }
    });

    view.append(addItem, playItem, albumItem);
    card.replaceChildren(view);
    if (menuPosition === null) menuPosition = place(card, rowRect, cursorY);
    else placeAt(card, menuPosition);
  };

  const renderPlaylistListView = (): void => {
    const view = el('div', 'ctx-view');

    const backBtn = el('button', 'ctx-back');
    backBtn.type = 'button';
    backBtn.textContent = '\u2039 Playlists';
    backBtn.setAttribute('aria-label', 'Back to menu');
    backBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      renderRootMenu();
    });
    view.append(backBtn);

    const finish = (): void => {
      flashRowCheck(row);
      window.setTimeout(() => closeMenu(true), 600);
    };

    const newInput = el('input', 'ctx-newpl-input');
    newInput.type = 'text';
    newInput.placeholder = 'New playlist\u2026';
    newInput.maxLength = 80;
    newInput.spellcheck = false;
    newInput.setAttribute('aria-label', 'Create playlist and add track');
    newInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const name = newInput.value.trim();
      if (name === '') return;
      void playlistsStore
        .create(name)
        .then((pl) => playlistsStore.addTrack(pl.id, refOf(track)))
        .then(finish);
    });
    view.append(newInput);

    let listed = false;
    for (const pl of playlistsStore.list()) {
      listed = true;
      const item = el('button', 'ctx-item ctx-pl-item');
      item.type = 'button';
      const name = el('span', 'ctx-item-label');
      name.textContent = pl.name;
      const count = el('span', 'mono dim ctx-item-count');
      count.textContent = String(pl.tracks.length);
      item.append(name, count);
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        void playlistsStore.addTrack(pl.id, refOf(track)).then(finish);
      });
      view.append(item);
    }
    if (!listed) {
      const hint = el('div', 'ctx-hint');
      hint.textContent = 'No playlists yet';
      view.append(hint);
    }

    card.replaceChildren(view);
    if (menuPosition === null) menuPosition = place(card, rowRect, cursorY);
    else placeAt(card, menuPosition);
  };

  document.body.append(card);
  menu = card;
  renderRootMenu();
  requestAnimationFrame(() => card.classList.add('open'));
}
function menuItem(label: string, arrow: string | null): HTMLButtonElement {
  const b = el('button', 'ctx-item');
  b.type = 'button';
  const s = el('span', 'ctx-item-label');
  s.textContent = label;
  b.append(s);
  if (arrow !== null) {
    const a = el('span', 'mono dim ctx-item-arrow');
    a.textContent = arrow;
    b.append(a);
  }
  return b;
}

function place(card: HTMLElement, rowRect: DOMRect, cursorY: number): { x: number; y: number } {
  const pw = card.offsetWidth;
  const ph = card.offsetHeight;
  const gap = 14;
  const rightX = rowRect.right + gap;
  const leftX = rowRect.left - pw - gap;
  let x = rightX + pw <= window.innerWidth - 12 ? rightX : leftX;
  x = Math.max(12, Math.min(x, window.innerWidth - pw - 12));
  let y = cursorY - 10;
  y = Math.max(12, Math.min(y, window.innerHeight - ph - 12));
  const position = { x: Math.round(x), y: Math.round(y) };
  card.style.left = `${position.x}px`;
  card.style.top = `${position.y}px`;
  return position;
}

function placeAt(card: HTMLElement, position: { x: number; y: number }): void {
  const maxX = Math.max(12, window.innerWidth - card.offsetWidth - 12);
  const maxY = Math.max(12, window.innerHeight - card.offsetHeight - 12);
  const x = Math.max(12, Math.min(position.x, maxX));
  const y = Math.max(12, Math.min(position.y, maxY));
  card.style.left = `${Math.round(x)}px`;
  card.style.top = `${Math.round(y)}px`;
}

function flashRowCheck(row: HTMLElement): void {
  const r = row.getBoundingClientRect();
  const badge = el('div', 'ctx-flash');
  badge.textContent = '\u2713';
  document.body.append(badge);
  const bw = badge.offsetWidth;
  const bh = badge.offsetHeight;
  const x = Math.max(12, Math.min(r.right - bw - 12, window.innerWidth - bw - 12));
  const y = Math.max(12, r.top + (r.height - bh) / 2);
  badge.style.left = Math.round(x).toString() + 'px';
  badge.style.top = Math.round(y).toString() + 'px';
  requestAnimationFrame(() => badge.classList.add('show'));
  window.setTimeout(() => {
    badge.classList.remove('show');
    window.setTimeout(() => badge.remove(), 220);
  }, 600);
}

function closeMenu(immediate = false): void {
  if (menu === null) return;
  const node = menu;
  menu = null;
  if (immediate) {
    node.remove();
    return;
  }
  node.classList.remove('open');
  window.setTimeout(() => node.remove(), 200);
}

function ensureOutsideBound(): void {
  if (outsideBound) return;
  outsideBound = true;
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (menu === null) return;
      const hit = e.target as Node | null;
      if (hit !== null && menu.contains(hit)) return;
      closeMenu(true);
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (menu === null || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    },
    true,
  );
  window.addEventListener(
    'scroll',
    () => {
      if (menu !== null) closeMenu(true);
    },
    true,
  );
}

function refOf(track: IndexedTrack): PlaylistTrackRef {
  return { trackId: track.id, absPath: track.absPath };
}
