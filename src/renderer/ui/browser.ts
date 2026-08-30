import { el, fmtTime, createArtImage, thumbOf } from '../core/dom';
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
import { isOverlayOpen, openNowPlaying, toggleNowPlaying } from './overlay';
import { ICON_SIGIL, ICON_NOTE, ICON_SEARCH } from './icons';
import { startBands, stopBands } from '../core/audioBands';
import { fallbackPalette, applyPalette, applyLyricsInk } from '../core/palette';
import { uiTheme } from '../core/uiTheme';
import { preview } from '../core/preview';
import { fx } from '../core/fx';
import { enqueueIdle } from '../core/peakAnalyzer';
import { Viz } from './viz';
import { createLyrics } from './lyrics';
import { renderTabCards, searchPlaylists, closePlaylistLayer, isPlaylistLayerOpen, openDetail, attachContextMenu } from './playlistsView';
import type { Playlist } from '../../shared/types';

type Mode = 'albums' | 'artists' | 'songs' | 'playlists';
type SortKey = 'alpha' | 'duration' | 'artist';

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
}

const state: BrowserState = { mode: 'albums', sort: 'alpha', artistFilter: null };

let idx: SearchIndexes = { songs: [], albums: [], artists: [] };
let libraryOk = false;

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

export function initBrowser(onCompactLyric?: (text: string | null, upcoming: boolean) => void): void {
  const host = document.querySelector<HTMLElement>('#carousel');
  const content = document.querySelector<HTMLElement>('#carousel-content');
  oracleInput =
    document.querySelector<HTMLInputElement>('#oracle-input') ??
    (() => {
      throw new Error('missing #oracle-input');
    })();
  oracleResults =
    document.querySelector<HTMLElement>('#oracle-results') ??
    (() => {
      throw new Error('missing #oracle-results');
    })();
  oracleCount =
    document.querySelector<HTMLSpanElement>('#oracle-count') ??
    (() => {
      throw new Error('missing #oracle-count');
    })();
  filterChip =
    document.querySelector<HTMLButtonElement>('#filter-chip') ??
    (() => {
      throw new Error('missing #filter-chip');
    })();
  detailLayer =
    document.querySelector<HTMLElement>('#detail-layer') ??
    (() => {
      throw new Error('missing #detail-layer');
    })();

  if (!host || !content) throw new Error('missing carousel nodes');
  const oracleIcon = document.querySelector<HTMLSpanElement>('#oracle-icon');
  if (oracleIcon) oracleIcon.innerHTML = ICON_SEARCH;

  detailLayer.addEventListener('click', (e) => {
    if (e.target !== detailLayer || !detailLayer.classList.contains('open')) return;
    closeDetail();
  });

  const npBtn = document.querySelector<HTMLButtonElement>('#np-open');
  if (npBtn) {
    npBtn.innerHTML = ICON_NOTE;
    npBtn.addEventListener('click', () => toggleNowPlaying());
    appBus.on('track-selected', () => {
      npBtn.disabled = false;
      npBtn.classList.add('lit');
    });
  }

  appBus.on('track-selected', ({ track }) => {
    playingId = track.id;
    markPlaying(track.id);
  });
  appBus.on('track-selected', ({ track }) => uiTheme.setBase(track.palette));

  window.addEventListener(
    'mr-go-to-album',
    (e) => {
      const detail = (e as CustomEvent).detail as { absPath?: string } | undefined;
      const absPath = detail?.absPath;
      if (!absPath) return;
      const track = libraryStore.getTrackList().find((t) => t.absPath === absPath);
      if (track === undefined) return;
      const album = idx.albums.find((a) => a.tracks.some((t) => t.id === track.id));
      if (album !== undefined) openAlbum(album);
    },
  );

  preview.bus.on('pending', ({ trackId }) => markPreview('preview-pending', trackId));
  preview.bus.on('active', ({ trackId }) => markPreview('previewing', trackId));

  const lyricsSlot = document.getElementById('lyrics-slot');
  if (lyricsSlot !== null) {
    stageLyrics = createLyrics(lyricsSlot, undefined, onCompactLyric);
    appBus.on('track-selected', ({ track }) => stageLyrics?.setTrack(track));
  }

  preview.enabled = state.mode === 'songs';
  wireTabs();
  wireSortChips();
  wireSearch();
  wireGlobalKeys();

  carousel = new Carousel(host, content);
  carousel.onViewportMove(queueSongWindowRefresh);

  libraryStore.onChange((result) => {
    libraryOk = result.ok;
    idx = buildSearchIndexes(result.ok ? result.tracks : []);
    render();
  });
  const initial = libraryStore.result;
  libraryOk = initial !== null && initial.ok;
  idx = buildSearchIndexes(initial !== null && initial.ok ? initial.tracks : []);
  render();
}

function wireTabs(): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('#mode-tabs button')) {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode as Mode | undefined;
      if (!mode) return;
      state.mode = mode;
      preview.enabled = mode === 'songs';
      if (mode !== 'albums') setArtistFilter(null);
      syncTabs();
      syncChips();
      render();
    });
  }
}

function wireSortChips(): void {
  for (const chip of document.querySelectorAll<HTMLButtonElement>('#sort-chips button')) {
    chip.addEventListener('click', () => {
      const sort = chip.dataset.sort as SortKey | undefined;
      if (!sort) return;
      state.sort = sort;
      syncChips();
      render();
    });
  }
}

function isOracleOpen(): boolean {
  const panel = document.getElementById('search-oracle');
  return panel !== null && !panel.hidden;
}

function openOracle(): void {
  const panel = document.getElementById('search-oracle');
  if (panel === null) return;
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add('open'));
  oracleInput.focus();
}

function closeOracle(): void {
  const panel = document.getElementById('search-oracle');
  if (panel === null) return;
  panel.classList.remove('open');
  panel.hidden = true;
  oracleInput.value = '';
  oracleInput.blur();
  oracleSongs = [];
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
        toggleNowPlaying();
        e.preventDefault();
        return;
      }
      if (detailOpen) {
        closeDetail();
        e.preventDefault();
        return;
      }
      if (isPlaylistLayerOpen()) {
        closePlaylistLayer();
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
      const hit = e.target as HTMLElement | null;
      if (hit !== null && hit.closest('#search-oracle') !== null) return;
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
  const playlistHits = searchPlaylists(query).slice(0, 5);
  let total = 0;

  const frag = document.createDocumentFragment();
  if (songHits.length > 0) {
    frag.append(sectionHeader('Songs'));
    oracleSongs = songHits.map((hit) => hit.item.track);
    for (const hit of songHits) {
      frag.append(songRow(hit.item.track));
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
  if (playlistHits.length > 0) {
    frag.append(sectionHeader('Playlists'));
    for (const hit of playlistHits) {
      frag.append(oraclePlaylistRow(hit));
      total += 1;
    }
  }

  if (total === 0) {
    oracleSongs = [];
    frag.append(hintNode('No echoes found.'));
  }

  oracleCount.textContent = `${total} found`;
  oracleResults.replaceChildren(frag);
}

function hintNode(text: string): HTMLElement {
  const node = el('div', 'oracle-hint mono dim');
  node.textContent = text;
  return node;
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
  sub.textContent = `${artist.albums.length} album${
    artist.albums.length === 1 ? '' : 's'
  } · ${artist.trackCount} tracks`;
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
    tab.classList.toggle('active', tab.dataset.mode === state.mode);
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
    const key = chip.dataset.sort as SortKey | undefined;
    chip.classList.toggle('active', key === state.sort && state.mode !== 'playlists');
    chip.textContent = labels[i] ?? '';
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

const SONG_ROW_HEIGHT = 96;
let pendingSwapTimer = 0;
let renderedMode: Mode | null = null;
let playingId: string | null = null;
let vlistTop = -1;
let vlistBottom = -1;
let windowRefreshQueued = false;

function padRowsFor(hostH: number): number {
  return Math.ceil((hostH * 1.5 + 240) / SONG_ROW_HEIGHT);
}

function songWindowBounds(hostH: number, posY: number): { start: number; end: number } {
  const len = lastSongList.length;
  if (len === 0) return { start: 0, end: 0 };
  const padRows = padRowsFor(hostH);
  const start = Math.max(0, Math.floor(posY / SONG_ROW_HEIGHT) - padRows);
  const end = Math.min(len, Math.ceil((posY + hostH) / SONG_ROW_HEIGHT) + padRows);
  return { start, end };
}

function buildSongsFragment(w: { start: number; end: number }): DocumentFragment {
  vlistTop = w.start;
  vlistBottom = w.end;
  const frag = document.createDocumentFragment();
  const gapTop = el('div', 'vlist-gap');
  gapTop.style.height = `${w.start * SONG_ROW_HEIGHT}px`;
  frag.append(gapTop);
  let stagger = 0;
  for (let i = w.start; i < w.end; i++) {
    const track = lastSongList[i];
    if (track === undefined) continue;
    frag.append(songRow(track, stagger >= 40 ? -1 : stagger));
    stagger += 1;
  }
  const gapBottom = el('div', 'vlist-gap');
  gapBottom.style.height = `${(lastSongList.length - w.end) * SONG_ROW_HEIGHT}px`;
  frag.append(gapBottom);
  return frag;
}

function mountSongsWindow(frag: DocumentFragment): void {
  const hostH = Math.max(320, carousel.viewHeight());
  frag.append(buildSongsFragment(songWindowBounds(hostH, carousel.getPos())));
}

function slideSongWindow(newStart: number, newEnd: number): void {
  const kids = carousel.windowContent().children;
  const gapTop = kids[0] as HTMLElement | undefined;
  const gapBottom = kids[kids.length - 1] as HTMLElement | undefined;
  if (gapTop === undefined || gapBottom === undefined) return;

  if (newStart > vlistTop) {
    for (let i = 0; i < newStart - vlistTop; i++) {
      const node = kids[1];
      if (node === undefined || node === gapBottom) break;
      node.remove();
    }
  } else if (newStart < vlistTop) {
    const rowsFrag = document.createDocumentFragment();
    for (let i = newStart; i < vlistTop; i++) {
      const track = lastSongList[i];
      if (track === undefined) continue;
      rowsFrag.append(songRow(track));
    }
    gapTop.after(rowsFrag);
  }

  if (newEnd > vlistBottom) {
    const rowsFrag = document.createDocumentFragment();
    for (let i = vlistBottom; i < newEnd; i++) {
      const track = lastSongList[i];
      if (track === undefined) continue;
      rowsFrag.append(songRow(track));
    }
    gapBottom.before(rowsFrag);
  } else if (newEnd < vlistBottom) {
    for (let i = 0; i < vlistBottom - newEnd; i++) {
      const node = kids[kids.length - 2];
      if (node === undefined || node === gapTop) break;
      node.remove();
    }
  }

  gapTop.style.height = `${newStart * SONG_ROW_HEIGHT}px`;
  gapBottom.style.height = `${(lastSongList.length - newEnd) * SONG_ROW_HEIGHT}px`;
  vlistTop = newStart;
  vlistBottom = newEnd;
}

function queueSongWindowRefresh(): void {
  if (windowRefreshQueued) return;
  windowRefreshQueued = true;
  requestAnimationFrame(() => {
    windowRefreshQueued = false;
    refreshSongWindow();
  });
}

function refreshSongWindow(): void {
  if (state.mode !== 'songs') return;
  if (vlistTop < 0 || vlistBottom < 0) return;
  const hostH = Math.max(320, carousel.viewHeight());
  const posY = carousel.getPos();
  const minBuffer = Math.max(1, Math.ceil(padRowsFor(hostH) / 2));
  const firstVisible = Math.floor(posY / SONG_ROW_HEIGHT);
  const lastVisible = Math.ceil((posY + hostH) / SONG_ROW_HEIGHT);
  const drained = firstVisible - vlistTop < minBuffer || vlistBottom - lastVisible < minBuffer;
  if (!drained) return;
  const w = songWindowBounds(hostH, posY);
  slideSongWindow(w.start, w.end);
  carousel.refresh();
}

function retractVisibleRows(): void {
  let n = 0;
  for (const node of carousel.bandChildren(2)) {
    if (!node.classList.contains('song-row')) continue;
    node.style.setProperty('--ed', `${Math.max(0, 160 - n * 14)}ms`);
    node.classList.add('leaving');
    n += 1;
  }
}

function render(immediate = false): void {
  preview.cancel();
  uiTheme.popPreview();
  const runSwap = (): void => {
    const frag = document.createDocumentFragment();
    if ((!libraryOk || idx.songs.length === 0) && state.mode !== 'playlists') {
      renderEmptyLibrary(frag);
      carousel.setContent(frag);
      syncFilterChip();
      renderedMode = state.mode;
      return;
    }
    if (state.mode === 'playlists') renderTabCards(frag);
    else renderBrowse(frag);
    carousel.setContent(frag);
    if (state.mode === 'songs') carousel.enterStagger();
    syncFilterChip();
    renderedMode = state.mode;
  };

  if (!immediate && fx.motion && fx.carousel && renderedMode === 'songs' && state.mode !== 'songs') {
    if (pendingSwapTimer !== 0) window.clearTimeout(pendingSwapTimer);
    retractVisibleRows();
    pendingSwapTimer = window.setTimeout(() => {
      pendingSwapTimer = 0;
      runSwap();
    }, 240);
    return;
  }
  runSwap();
}

function renderEmptyLibrary(frag: DocumentFragment): void {
  const wrap = el('div', 'empty-library');
  const title = el('div', 'empty-title');
  title.textContent = libraryOk ? 'The archive is empty' : 'The archive is unreachable';
  const sub = el('div', 'empty-sub dim');
  sub.textContent = libraryOk
    ? 'Point MotiveRevival at a music folder and the sky will fill.'
    : 'Your music folders could not be read. Check them in settings.';
  const btn = el('button', 'ghost-btn');
  btn.type = 'button';
  btn.textContent = 'Open settings';
  btn.addEventListener('click', () => {
    document.getElementById('btn-settings')?.click();
  });
  wrap.append(title, sub, btn);
  frag.append(wrap);
}

function renderBrowse(frag: DocumentFragment): void {
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
      break;
    }
    case 'artists': {
      for (const artist of sortArtists(idx.artists)) frag.append(artistCard(artist));
      break;
    }
    case 'songs': {
      lastSongList = sortSongs(idx.songs.map((s) => s.track));
      mountSongsWindow(frag);
      break;
    }
    default:
      break;
  }
}

function sectionHeader(label: string): HTMLElement {
  return artistHeader(label);
}

function scoreOf<T>(items: readonly T[], query: string): Array<{ item: T; score: number }> {
  const out: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const candidate = item as { hay?: unknown };
    if (typeof candidate.hay !== 'string') continue;
    const score = fuzzyScore(query, candidate.hay);
    if (score !== null) out.push({ item, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
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

function artInto(host: HTMLElement, artFile: string | null, imgClass: string, preferThumb = false): void {
  if (artFile !== null) {
    const fullUrl = mediaUrl(artFile);
    const img = createArtImage(preferThumb ? mediaUrl(thumbOf(artFile)) : fullUrl, preferThumb ? { fallbackUrl: fullUrl } : undefined);
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
  // Owner toggle: false returns single-song albums to direct-play without opening the stage.
  const openSingleStage = true;
  card.addEventListener('click', () => {
    if (carousel.wasDrag()) return;
    if (!openSingleStage && album.tracks.length === 1) {
      player.setContext(album.tracks, 0);
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
  artInto(avatar, artist.artFile, 'card-img', true);

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

const UNKNOWN_ARTIST = 'Unknown Artist';

function songRow(
  track: import('../../shared/types').IndexedTrack,
  enterIndex = -1,
): HTMLElement {
  const row = el('div', 'card song-row');
  row.dataset.interactive = '1';
  row.dataset.trackId = track.id;
  if (enterIndex >= 0) row.style.setProperty('--ed', `${Math.min(enterIndex * 12, 420)}ms`);
  if (track.id === playingId) row.classList.add('playing');

  const thumb = el('div', 'song-thumb');
  artInto(thumb, track.artFile, 'card-img', true);

  const meta = el('div', 'song-meta');
  const title = el('div', 'song-title');
  title.textContent = track.title;
  const sub = el('div', 'mono dim song-sub');
  sub.textContent = `${track.artist ?? UNKNOWN_ARTIST}${
    track.album !== null ? ` — ${track.album}` : ''
  }`;
  meta.append(title, sub);

  const dur = el('div', 'mono dim song-dur');
  dur.textContent =
    track.durationSec !== null && Number.isFinite(track.durationSec)
      ? fmtTime(track.durationSec)
      : '--:--';

  row.append(thumb, meta, dur);
  attachPreview(row, track);
  attachContextMenu(row, track, () => {
    preview.hardStop();
    playFromList(track, row);
  });
  row.addEventListener('click', () => {
    if (carousel.wasDrag()) return;
    if (playingId === track.id) {
      openNowPlaying();
      return;
    }
    preview.hardStop();
    playFromList(track, row);
  });
  return row;
}

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
    if (!carousel.busy()) uiTheme.pushPreview(track.palette);
  });
  row.addEventListener('mouseleave', () => {
    preview.hoverLeave();
    if (!carousel.busy()) uiTheme.popPreview();
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
  attachContextMenu(cell, track, () => {
    preview.hardStop();
    player.setContext(context, index);
  });
  cell.addEventListener('click', () => {
    preview.hardStop();
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

function oraclePlaylistRow(hit: { playlist: Playlist }): HTMLElement {
  const pl = hit.playlist;
  const row = el('div', 'oracle-row');
  row.dataset.interactive = '1';

  const cover = pl.tracks
    .map((ref) => libraryStore.getTrackList().find((t) => t.id === ref.trackId))
    .find((t) => t?.artFile !== null && t !== undefined);

  const thumb = el('div', 'song-thumb');
  artInto(thumb, cover?.artFile ?? null, 'card-img');

  const meta = el('div', 'song-meta');
  const title = el('div', 'song-title');
  title.textContent = pl.name;
  const sub = el('div', 'mono dim song-sub');
  sub.textContent = `Playlist · ${pl.tracks.length} track${pl.tracks.length === 1 ? '' : 's'}`;
  meta.append(title, sub);

  row.append(thumb, meta);
  row.addEventListener('click', () => {
    closeOracle();
    openDetail(pl.id);
  });
  return row;
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
