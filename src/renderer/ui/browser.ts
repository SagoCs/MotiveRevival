import { el, fmtTime } from '../core/dom';
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
import { closeNowPlaying, isOverlayOpen, openNowPlaying, toggleNowPlaying } from './overlay';
import { ICON_SIGIL, ICON_BACK, ICON_NOTE, ICON_SEARCH } from './icons';
import { startBands, stopBands } from '../core/audioBands';
import { fallbackPalette, applyPalette, applyLyricsInk } from '../core/palette';
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
let searchInput: HTMLInputElement;
let searchCount: HTMLSpanElement;
let filterChip: HTMLButtonElement;
let detailLayer: HTMLElement;
let detailOpen = false;
let activeDetailKey: string | null = null;
let debounceHandle = 0;
let stageViz: Viz | null = null;
let stageLyrics: ReturnType<typeof createLyrics> | null = null;
let lastSongList: import('../../shared/types').IndexedTrack[] = [];

export function initBrowser(): void {
  const host = document.querySelector<HTMLElement>('#carousel');
  const content = document.querySelector<HTMLElement>('#carousel-content');
  searchInput = document.querySelector<HTMLInputElement>('#search-input') ?? (() => { throw new Error('missing #search-input'); })();
  searchCount = document.querySelector<HTMLSpanElement>('#search-count') ?? (() => { throw new Error('missing #search-count'); })();
  filterChip = document.querySelector<HTMLButtonElement>('#filter-chip') ?? (() => { throw new Error('missing #filter-chip'); })();
  detailLayer = document.querySelector<HTMLElement>('#detail-layer') ?? (() => { throw new Error('missing #detail-layer'); })();

  if (!host || !content) throw new Error('missing carousel nodes');

  const searchIcon = document.querySelector<HTMLSpanElement>('#search-icon');
  if (searchIcon) searchIcon.innerHTML = ICON_SEARCH;

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
  searchInput.addEventListener('input', () => {
    window.clearTimeout(debounceHandle);
    debounceHandle = window.setTimeout(() => {
      state.query = searchInput.value;
      render();
    }, 110);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      carousel.firstInteractive()?.click();
    }
  });

  filterChip.addEventListener('click', () => {
    setArtistFilter(null);
    render();
  });
}

function wireGlobalKeys(): void {
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    const inInput = target !== null && target.closest('input, textarea, select') !== null;
    const settingsOpen =
      document.querySelector('#settings-modal')?.classList.contains('open') === true;

    if (e.key === 'Escape') {
      if (settingsOpen) return;
      if (state.query !== '' || searchInput.value !== '') {
        clearSearch();
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
      searchInput.focus();
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
      searchInput.focus();
      const start = searchInput.selectionStart ?? searchInput.value.length;
      const end = searchInput.selectionEnd ?? searchInput.value.length;
      searchInput.setRangeText(e.key, start, end, 'end');
      state.query = searchInput.value;
      render();
    }
  });
}

function clearSearch(): void {
  searchInput.value = '';
  state.query = '';
  searchInput.blur();
  render();
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
  let shown = 0;
  let total = 0;

  if (state.mode === 'playlists' && state.query.trim() === '') {
    frag.append(playlistsEmpty());
    carousel.setContent(frag);
    searchCount.textContent = '';
    syncFilterChip();
    return;
  }

  if (state.query.trim() !== '') {
    shown = renderSearch(frag);
    total = shown;
  } else {
    const counts = renderBrowse(frag);
    shown = counts.shown;
    total = counts.total;
  }

  carousel.setContent(frag);

  if (state.query.trim() !== '') {
    searchCount.textContent = `${shown} found`;
  } else {
    searchCount.textContent = `${total} ${total === 1 ? 'item' : 'items'}`;
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

function renderSearch(frag: DocumentFragment): number {
  const q = state.query.trim();

  const songHits = scoreOf(idx.songs, q).slice(0, 14);
  const albumHits = scoreOf(idx.albums, q).slice(0, 8);
  const artistHits = scoreOf(idx.artists, q).slice(0, 6);

  let shown = 0;

  if (songHits.length > 0) {
    frag.append(sectionHeader('Songs'));
    lastSongList = songHits.map((hit) => hit.item.track);
    for (const hit of songHits) {
      frag.append(songRow(hit.item.track));
      shown += 1;
    }
  }
  if (albumHits.length > 0) {
    frag.append(sectionHeader('Albums'));
    for (const hit of albumHits) {
      frag.append(albumCard(hit.item));
      shown += 1;
    }
  }
  if (artistHits.length > 0) {
    frag.append(sectionHeader('Artists'));
    for (const hit of artistHits) {
      frag.append(artistCard(hit.item));
      shown += 1;
    }
  }

  if (shown === 0) frag.append(noResults());
  return shown;
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
    const img = document.createElement('img');
    img.className = imgClass;
    img.alt = '';
    img.loading = 'lazy';
    img.src = mediaUrl(artFile);
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
  row.addEventListener('click', () => {
    if (carousel.wasDrag()) return;
    playFromList(track);
  });
  return row;
}

const UNKNOWN_ARTIST = 'Unknown Artist';

function playFromList(track: import('../../shared/types').IndexedTrack): void {
  const index = lastSongList.findIndex((t) => t.id === track.id);
  if (index >= 0) {
    player.setContext(lastSongList, index);
  } else {
    player.setContext([track], 0);
  }
}

function markPlaying(trackId: string): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-track-id].playing')) {
    node.classList.remove('playing');
  }
  document.querySelector<HTMLElement>(`[data-track-id="${trackId}"]`)?.classList.add('playing');
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
  cell.addEventListener('click', () => {
    player.setContext(context, index);
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
