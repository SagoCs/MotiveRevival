import { el, fmtTime, createArtImage } from '../core/dom';
import { mediaUrl, player } from '../core/player';
import { appBus } from '../core/appBus';
import { libraryStore } from '../core/libraryStore';
import { fuzzyScore } from '../core/fuzzy';
import {
  buildSearchIndexes,
  fmtTotal,
  type AlbumEntry,
  type ArtistEntry,
  type SearchIndexes,
} from '../core/searchIndex';
import { Carousel } from './carousel';
import { closeNowPlaying, isOverlayOpen, openNowPlayingFromRect, toggleNowPlaying } from './overlay';
import { ICON_SIGIL, ICON_BACK, ICON_NOTE, ICON_SEARCH } from './icons';
import { startBands, stopBands } from '../core/audioBands';
import { fallbackPalette, applyPalette, applyLyricsInk } from '../core/palette';
import { uiTheme } from '../core/uiTheme';
import { preview } from '../core/preview';
import { enqueueIdle } from '../core/peakAnalyzer';
import { Viz } from './viz';
import { createLyrics } from './lyrics';

type Mode = 'albums' | 'artists' | 'songs' | 'playlists';
type SortKey = 'alpha' | 'duration' | 'artist';

const MODES: Mode[] = ['albums', 'artists', 'songs', 'playlists'];
const SORTS: SortKey[] = ['alpha', 'duration', 'artist'];

const SORT_LABELS: Record<Mode, [string, string, string]> = {
  albums: ['A–Z', 'Longest', 'Artist'],
  artists: ['A–Z', 'Longest', 'Tracks'],
  songs: ['A–Z', 'Longest', 'Artist'],
  playlists: ['A–Z', 'Longest', 'Tracks'],
};

interface BrowserState {
  mode: Mode;
  sort: SortKey;
  artistFilter: string | null;
  query: string;
}

const state: BrowserState = { mode: 'albums', sort: 'alpha', artistFilter: null, query: '' };

let idx: SearchIndexes = { songs: [], albums: [], artists: [] };

let carousel: Carousel;
let oracleInput: HTMLInputElement;
let oracleResults: HTMLElement;
let oracleCount: HTMLSpanElement;
let filterChip: HTMLButtonElement;
let detailLayer: HTMLElement;
let detailOpen = false;
let activeDetailKey: string | null = null;
let debounceHandle = 0;
let stageViz: Viz | null = null;
let stageLyrics: ReturnType<typeof createLyrics> | null = null;
let lastSongList: import('../../shared/types').IndexedTrack[] = [];
let oracleSongs: import('../../shared/types').IndexedTrack[] = [];

export function initBrowser(): void {
  const host = document.querySelector<HTMLElement>('#carousel');
  const content = document.querySelector<HTMLElement>('#carousel-content');
  oracleInput = document.querySelector<HTMLInputElement>('#oracle-input') ?? (() => { throw new Error('missing #oracle-input'); })();
  oracleResults = document.querySelector<HTMLElement>('#oracle-results') ?? (() => { throw new Error('missing #oracle-results'); })();
  oracleCount = document.querySelector<HTMLSpanElement>('#oracle-count') ?? (() => { throw new Error('missing #oracle-count'); })();
  filterChip = document.querySelector<HTMLButtonElement>('#filter-chip') ?? (() => { throw new Error('missing #filter-chip'); })();
  detailLayer = document.querySelector<HTMLElement>('#detail-layer') ?? (() => { throw new Error('missing #detail-layer'); })();

  if (!host || !content) throw new Error('missing carousel nodes');

  const oracleIcon = document.querySelector<HTMLSpanElement>('#oracle-icon');
  if (oracleIcon) oracleIcon.innerHTML = ICON_SEARCH;

  appBus.on('track-selected', ({ track }) => uiTheme.setBase(track.palette));

  const backBtn = document.querySelector<HTMLButtonElement>('#detail-back');
  if (backBtn) {
    backBtn.innerHTML = ICON_BACK;
    backBtn.addEventListener('click', () => closeDetail());
  }

  const npBtn = document.querySelector<HTMLButtonElement>('#np-open');
  if (npBtn) {
    npBtn.innerHTML = ICON_NOTE;
    npBtn.addEventListener('click', () => toggleNowPlaying());
    appBus.on('track-selected', () => {
      npBtn.disabled = false;
      npBtn.classList.add('lit');
    });
  }

  appBus.on('track-selected', ({ track }) => markPlaying(track.id));
  appBus.on('track-selected', ({ track }) => uiTheme.setBase(track.palette));

  preview.bus.on('pending', ({ trackId }) => markPreview('preview-pending', trackId));
  preview.bus.on('active', ({ trackId }) => markPreview('previewing', trackId));

  const lyricsSlot = document.getElementById('lyrics-slot');
  if (lyricsSlot !== null) {
    stageLyrics = createLyrics(lyricsSlot);
    appBus.on('track-selected', ({ track }) => stageLyrics?.setTrack(track));
  }

  wireTabs();
  wireSortChips();
  wireSearch();
  wireGlobalKeys();

  carousel = new Carousel(host, content);

  libraryStore.onChange((result) => {
    idx = buildSearchIndexes(result.ok ? result.tracks : []);
    render();
  });
  const initial = libraryStore.result;
  idx = buildSearchIndexes(initial !== null && initial.ok ? initial.tracks : []);
  render();
}

function wireTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('#mode-tabs button');
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode as Mode | undefined;
      if (!mode) return;
      state.mode = mode;
      if (mode !== 'albums') setArtistFilter(null);
      syncTabs();
      syncChips();
      render();
    });
  }
}

function wireSortChips(): void {
  const chips = document.querySelectorAll<HTMLButtonElement>('#sort-chips button');
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const sort = chip.dataset.sort as SortKey | undefined;
      if (!sort) return;
      state.sort = sort;
      syncChips();
      render();
    });
  }
}

function wireSearch(): void {
  oracleInput.addEventListener('input', () => {
    window.clearTimeout(debounceHandle);
    debounceHandle = window.setTimeout(() => {
      renderOracleResults();
    }, 110);
  });
  oracleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      oracleResults.querySelector<HTMLElement>('[data-interactive]')?.click();
    }
  });

  filterChip.addEventListener('click', () => {
    setArtistFilter(null);
    render();
  });
}

function isOracleOpen(): boolean {
  const el = document.getElementById('search-oracle');
  return el !== null && !el.hidden;
}

function openOracle(): void {
  const el = document.getElementById('search-oracle');
  if (el === null) return;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('open'));
  oracleInput.focus();
}

function closeOracle(): void {
  const el = document.getElementById('search-oracle');
  if (el === null) return;
  el.classList.remove('open');
  el.hidden = true;
  oracleInput.value = '';
  oracleInput.blur();
  oracleSongs = [];
}

function wireGlobalKeys(): void {
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    const inInput = target !== null && target.closest('input, textarea, select') !== null;
    const settingsOpen =
      document.querySelector('#settings-modal')?.classList.contains('open') === true;

    if (e.key === 'Escape') {
      if (settingsOpen) return;
      if (isOracleOpen()) {
        closeOracle();
        e.preventDefault();
        return;
      }
      if (isOverlayOpen()) {
        closeNowPlaying();
        e.preventDefault();
        return;
      }
      if (detailOpen) {
        closeDetail();
        e.preventDefault();
        return;
      }
      return;
    }

    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (!inInput && e.key === '/') {
      e.preventDefault();
      openOracle();
      renderOracleResults();
      return;
    }

    if (!inInput && e.code === 'Space') {
      if (target?.closest('button, [role="slider"]')) return;
      e.preventDefault();
      player.toggle();
      return;
    }

    if (!inInput && e.key.length === 1) {
      e.preventDefault();
      openOracle();
      const start = oracleInput.selectionStart ?? oracleInput.value.length;
      const end = oracleInput.selectionEnd ?? oracleInput.value.length;
      oracleInput.setRangeText(e.key, start, end, 'end');
      renderOracleResults();
    }
  });

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!isOracleOpen()) return;
      const t = e.target as HTMLElement | null;
      if (t !== null && t.closest('#search-oracle') !== null) return;
      closeOracle();
    },
    true,
  );
}

function renderOracleResults(): void {
  const query = oracleInput.value.trim();

  if (query === '') {
    oracleSongs = [];
    oracleCount.textContent = '';
    oracleResults.replaceChildren(hintNode('Type to summon the archive…'));
    return;
  }

  const songHits = scoreOf(idx.songs, query).slice(0, 12);
  const albumHits = scoreOf(idx.albums, query).slice(0, 8);
  const artistHits = scoreOf(idx.artists, query).slice(0, 6);
  let total = 0;

  const frag = document.createDocumentFragment();
  if (songHits.length > 0) {
    frag.append(sectionHeader('Songs'));
    oracleSongs = songHits.map((hit) => hit.item.track);
    for (const hit of songHits) {
      frag.append(oracleSongRow(hit.item.track));
      total += 1;
    }
  }
  if (albumHits.length > 0) {
    frag.append(sectionHeader('Albums'));
    for (const hit of albumHits) {
      frag.append(oracleAlbumRow(hit.item));
      total += 1;
    }
  }
  if (artistHits.length > 0) {
    frag.append(sectionHeader('Artists'));
    for (const hit of artistHits) {
      frag.append(oracleArtistRow(hit.item));
      total += 1;
    }
  }

  if (total === 0) {
    frag.append(hintNode('No echoes found.'));
    oracleSongs = [];
  }

  oracleCount.textContent = `${total} found`;
  oracleResults.replaceChildren(frag);
}

function hintNode(text: string): HTMLElement {
  const node = el('div', 'oracle-hint mono dim');
  node.textContent = text;
  return node;
}

function oracleSongRow(track: import('../../shared/types').IndexedTrack): HTMLElement {
  const row = songRow(track);
  row.style.width = '100%';
  return row;
}

function oracleAlbumRow(album: AlbumEntry): HTMLElement {
  const row = el('div', 'oracle-row');
  row.dataset.interactive = '1';

  const thumb = el('div', 'song-thumb');
  artInto(thumb, album.artFile, 'card-img');

  const meta = el('div', 'song-meta');
  const title = el('div', 'song-title');
  title.textContent = album.name;
  const sub = el('div', 'mono dim song-sub');
  sub.textContent = `${album.artist} · ${album.tracks.length} track${
    album.tracks.length === 1 ? '' : 's'
  }`;
  meta.append(title, sub);

  row.append(thumb, meta);
  row.addEventListener('click', () => {
    closeOracle();
    openAlbum(album);
  });
  return row;
}

function oracleArtistRow(artist: ArtistEntry): HTMLElement {
  const row = el('div', 'oracle-row');
  row.dataset.interactive = '1';

  const thumb = el('div', 'song-thumb');
  artInto(thumb, artist.artFile, 'card-img');

  const meta = el('div', 'song-meta');
  const title = el('div', 'song-title');
  title.textContent = artist.name;
  const sub = el('div', 'mono dim song-sub');
  sub.textContent = `${artist.albums.length} album${artist.albums.length === 1 ? '' : 's'} · ${artist.trackCount} tracks`;
  meta.append(title, sub);

  row.append(thumb, meta);
  row.addEventListener('click', () => {
    closeOracle();
    state.mode = 'albums';
    setArtistFilter(artist.key);
    syncTabs();
    syncChips();
    render();
  });
  return row;
}

function setArtistFilter(key: string | null): void {
  state.artistFilter = key;
  syncFilterChip();
}

function syncTabs(): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('#mode-tabs button')) {
    tab.classList.toggle('active', tab.dataset['mode'] === state.mode);
  }
}

function syncChips(): void {
  const labels = SORT_LABELS[state.mode];
  const chipsNav = document.querySelector<HTMLElement>('#sort-chips');
  if (chipsNav !== null) {
    chipsNav.classList.toggle('is-disabled', state.mode === 'playlists');
  }
  let i = 0;
  for (const chip of document.querySelectorAll<HTMLButtonElement>('#sort-chips button')) {
    const key = chip.dataset['sort'] as SortKey | undefined;
    chip.classList.toggle('active', key === state.sort && state.mode !== 'playlists');
    const label = labels[i] ?? '';
    chip.textContent = label;
    i += 1;
  }
}

function syncFilterChip(): void {
  if (state.artistFilter === null) {
    filterChip.hidden = true;
    return;
  }
  const artist = idx.albums.find((a) => a.artist.toLowerCase() === state.artistFilter);
  filterChip.textContent = `Clear · ${artist?.name ?? state.artistFilter}`;
  filterChip.hidden = false;
}

function render(): void {
  const frag = document.createDocumentFragment();
  let total = 0;

  if (state.mode === 'playlists') {
    frag.append(playlistsEmpty());
  } else {
    const counts = renderBrowse(frag);
    total = counts.total;
  }

  carousel.setContent(frag);

  const countEl = document.getElementById('oracle-count');
  if (countEl !== null && state.query.trim() === '') {
    countEl.textContent = `${total} ${total === 1 ? 'item' : 'items'}`;
  }
  syncFilterChip();
}

function renderBrowse(frag: DocumentFragment): { shown: number; total: number } {
  switch (state.mode) {
    case 'albums': {
      let albums = idx.albums;
      if (state.artistFilter !== null) {
        albums = albums.filter((a) => a.artist.toLowerCase() === state.artistFilter);
      }
      const sorted = sortAlbums(albums);
      let lastArtist: string | null = null;
      for (const album of sorted) {
        if (album.artist !== lastArtist) {
          lastArtist = album.artist;
          frag.append(artistHeader(album.artist));
        }
        frag.append(albumCard(album));
      }
      return { shown: sorted.length, total: sorted.length };
    }
    case 'artists': {
      const sorted = sortArtists(idx.artists);
      for (const artist of sorted) frag.append(artistCard(artist));
      return { shown: sorted.length, total: sorted.length };
    }
    case 'songs': {
      const sorted = sortSongs(idx.songs.map((s) => s.track));
      lastSongList = sorted;
      for (const track of sorted) frag.append(songRow(track));
      return { shown: sorted.length, total: sorted.length };
    }
    default:
      return { shown: 0, total: 0 };
  }
}

function sectionHeader(label: string): HTMLElement {
  return artistHeader(label);
}

function scoreOf<T>(items: readonly T[], query: string): Array<{ item: T; score: number }> {
  const out: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const hay = hayOf(item);
    if (hay === undefined) continue;
    const score = fuzzyScore(query, hay);
    if (score !== null) out.push({ item, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function hayOf(item: unknown): string | undefined {
  const candidate = item as { hay?: unknown };
  return typeof candidate.hay === 'string' ? candidate.hay : undefined;
}

function sortAlbums(albums: readonly AlbumEntry[]): AlbumEntry[] {
  const list = [...albums];
  if (state.sort === 'duration') list.sort((a, b) => b.totalDuration - a.totalDuration);
  else if (state.sort === 'artist')
    list.sort((a, b) => a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name));
  else list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function sortArtists(artists: readonly ArtistEntry[]): ArtistEntry[] {
  const list = [...artists];
  if (state.sort === 'duration') list.sort((a, b) => b.totalDuration - a.totalDuration);
  else if (state.sort === 'artist') list.sort((a, b) => b.trackCount - a.trackCount);
  else list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function sortSongs(tracks: readonly import('../../shared/types').IndexedTrack[]) {
  const list = [...tracks];
  if (state.sort === 'duration') list.sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0));
  else if (state.sort === 'artist')
    list.sort(
      (a, b) =>
        (a.albumArtist ?? a.artist ?? '~').localeCompare(b.albumArtist ?? b.artist ?? '~') ||
        (a.album ?? '').localeCompare(b.album ?? '') ||
        compareNullable(a.trackNo, b.trackNo),
    );
  else list.sort((a, b) => a.title.localeCompare(b.title));
  return list;
}

function compareNullable(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function artInto(host: HTMLElement, artFile: string | null, imgClass: string): void {
  if (artFile !== null) {
    const img = createArtImage(mediaUrl(artFile));
    img.className = imgClass;
    host.replaceChildren(img);
  } else {
    host.classList.add('noart');
    host.innerHTML = ICON_SIGIL;
  }
}

function artistHeader(name: string): HTMLElement {
  const header = el('div', 'artist-header');
  const label = el('span', 'artist-header-name');
  label.textContent = name;
  const line = el('span', 'artist-header-line');
  header.append(label, line);
  return header;
}

function albumCard(album: AlbumEntry): HTMLElement {
  const card = el('div', 'card album-card');
  card.dataset.interactive = '1';
  applyPalette(card, album.palette ?? fallbackPalette(album.key));

  const art = el('div', 'card-art');
  artInto(art, album.artFile, 'card-img');

  const meta = el('div', 'card-meta');
  const title = el('div', 'card-title');
  title.textContent = album.name;
  const sub = el('div', 'mono dim card-sub');
  sub.textContent = `${album.artist} · ${album.tracks.length} track${
    album.tracks.length === 1 ? '' : 's'
  } · ${fmtTotal(album.totalDuration)}`;
  meta.append(title, sub);

  card.append(art, meta);
  card.addEventListener('click', () => {
    if (carousel.wasDrag()) return;
    if (album.tracks.length === 1) {
      const only = album.tracks[0];
      if (only !== undefined) player.setContext(album.tracks, 0);
      return;
    }
    openAlbum(album);
  });
  return card;
}

function artistCard(artist: ArtistEntry): HTMLElement {
  const card = el('div', 'card artist-card');
  card.dataset.interactive = '1';

  const avatar = el('div', 'artist-avatar');
  artInto(avatar, artist.artFile, 'card-img');

  const meta = el('div', 'card-meta');
  const title = el('div', 'card-title');
  title.textContent = artist.name;
  const sub = el('div', 'mono dim card-sub');
  sub.textContent = `${artist.albums.length} album${artist.albums.length === 1 ? '' : 's'} · ${
    artist.trackCount
  } tracks`;
  meta.append(title, sub);

  card.append(avatar, meta);
  card.addEventListener('click', () => {
    if (carousel.wasDrag()) return;
    setArtistFilter(artist.key);
    state.mode = 'albums';
    syncTabs();
    syncChips();
    render();
  });
  return card;
}

function songRow(track: import('../../shared/types').IndexedTrack): HTMLElement {
  const row = el('div', 'card song-row');
  row.dataset.interactive = '1';
  row.dataset.trackId = track.id;

  const thumb = el('div', 'song-thumb');
  artInto(thumb, track.artFile, 'card-img');

  const meta = el('div', 'song-meta');
  const title = el('div', 'song-title');
  title.textContent = track.title;
  const sub = el('div', 'mono dim song-sub');
  sub.textContent = `${track.artist ?? UNKNOWN_ARTIST}${track.album !== null ? ` — ${track.album}` : ''}`;
  meta.append(title, sub);

  const dur = el('div', 'mono dim song-dur');
  dur.textContent = track.durationSec !== null && Number.isFinite(track.durationSec) ? fmtTime(track.durationSec) : '--:--';

  row.append(thumb, meta, dur);
  attachPreview(row, track);
  row.addEventListener('click', () => {
    if (carousel.wasDrag()) return;
    preview.hardStop();
    playFromList(track, row);
  });
  return row;
}

const UNKNOWN_ARTIST = 'Unknown Artist';

function playFromList(
  track: import('../../shared/types').IndexedTrack,
  sourceRow?: HTMLElement,
): void {
  const index = lastSongList.findIndex((t) => t.id === track.id);
  if (index >= 0) {
    player.setContext(lastSongList, index);
  } else {
    player.setContext([track], 0);
  }
  const thumb = sourceRow?.querySelector<HTMLElement>('.song-thumb');
  const rect = (thumb ?? sourceRow)?.getBoundingClientRect() ?? null;
  openNowPlayingFromRect(rect, track.artFile !== null ? mediaUrl(track.artFile) : null);
}

function markPlaying(trackId: string): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-track-id].playing')) {
    node.classList.remove('playing');
  }
  document.querySelector<HTMLElement>(`[data-track-id="${trackId}"]`)?.classList.add('playing');
}

function markPreview(className: 'preview-pending' | 'previewing', trackId: string | null): void {
  for (const node of document.querySelectorAll<HTMLElement>(`[data-track-id].${className}`)) {
    node.classList.remove(className);
  }
  if (trackId === null) return;
  document.querySelector<HTMLElement>(`[data-track-id="${trackId}"]`)?.classList.add(className);
}

function attachPreview(row: HTMLElement, track: import('../../shared/types').IndexedTrack): void {
  row.addEventListener('mouseenter', () => {
    preview.hoverEnter(track);
    uiTheme.pushPreview(track.palette);
  });
  row.addEventListener('mouseleave', () => {
    preview.hoverLeave();
    uiTheme.popPreview();
  });
}

function openAlbum(album: AlbumEntry): void {
  activeDetailKey = album.key;
  const art = document.querySelector<HTMLElement>('#detail-art');
  const titleEl = document.querySelector<HTMLElement>('#detail-title');
  const subEl = document.querySelector<HTMLElement>('#detail-sub');
  const list = document.querySelector<HTMLOListElement>('#detail-tracks');
  if (!art || !titleEl || !subEl || !list) return;

  applyPalette(detailLayer, album.palette ?? fallbackPalette(album.key));
  applyLyricsInk(detailLayer, album.palette);
  artInto(art, album.artFile, 'detail-img');
  titleEl.textContent = album.name;
  subEl.textContent = `${album.artist}${
    album.year !== null ? ` · ${album.year}` : ''
  } · ${album.tracks.length} tracks · ${fmtTotal(album.totalDuration)}`;

  list.replaceChildren();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < album.tracks.length; i++) {
    const track = album.tracks[i];
    if (track === undefined) continue;
    frag.append(miniCell(track, i, album.tracks));
  }
  list.append(frag);

  detailOpen = true;
  detailLayer.hidden = false;
  requestAnimationFrame(() => detailLayer.classList.add('open'));

  if (stageViz === null) {
    const cv = document.querySelector<HTMLCanvasElement>('#stage-viz');
    if (cv !== null) stageViz = new Viz(cv, detailLayer);
  }
  startBands();
}

function miniCell(
  track: import('../../shared/types').IndexedTrack,
  index: number,
  context: readonly import('../../shared/types').IndexedTrack[],
): HTMLElement {
  const cell = el('li', 'mini-cell');
  cell.dataset.interactive = '1';
  cell.dataset.trackId = track.id;
  cell.style.animationDelay = `${Math.min(index * 24, 320)}ms`;

  const n = el('span', 'mono det-index');
  n.textContent = String(index + 1).padStart(2, '0');

  const thumb = el('div', 'mini-thumb');
  artInto(thumb, track.artFile, 'card-img');

  const t = el('div', 'det-title');
  t.textContent = track.title;

  const d = el('span', 'mono dim det-dur');
  d.textContent =
    track.durationSec !== null && Number.isFinite(track.durationSec)
      ? fmtTime(track.durationSec)
      : '--:--';

  cell.append(n, thumb, t, d);
  attachPreview(cell, track);
  cell.addEventListener('click', () => {
    preview.hardStop();
    player.setContext(context, index);
    const rect = thumb.getBoundingClientRect();
    openNowPlayingFromRect(rect, track.artFile !== null ? mediaUrl(track.artFile) : null);
  });
  return cell;
}

function closeDetail(): void {
  detailOpen = false;
  activeDetailKey = null;
  detailLayer.classList.remove('open');
  stopBands();
  window.setTimeout(() => {
    if (!detailOpen) detailLayer.hidden = true;
  }, 460);
}

function noResults(): HTMLElement {
  const wrap = el('div', 'empty-note');
  const msg = el('div', 'empty-title');
  msg.textContent = 'No echoes found';
  const hint = el('div', 'dim empty-hint');
  hint.textContent = 'Try fewer letters — the stars are forgiving.';
  wrap.append(msg, hint);
  return wrap;
}

function playlistsEmpty(): HTMLElement {
  const wrap = el('div', 'empty-note');
  const msg = el('div', 'empty-title');
  msg.textContent = 'Playlists';
  const hint = el('div', 'dim empty-hint');
  hint.textContent = 'They awaken in Movement VII.';
  wrap.append(msg, hint);
  return wrap;
}
