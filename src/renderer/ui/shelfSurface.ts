import '../styles/shelf.css';
import { libraryStore } from '../core/libraryStore';
import { mediaUrl, player } from '../core/player';
import { primaryOf } from '../core/searchIndex';
import { playlistsStore } from '../core/playlistsStore';
import { uiTheme } from '../core/uiTheme';
import { deriveAccent } from '../core/palette';
import { createShelf } from './shelf';
import type { ShelfEntry, ShelfRegion } from './shelf';
import type { IndexedTrack } from '../../shared/types';

const BEZEL_H = 52;
const TIMELINE_H = 62;

type Lens = 'artists' | 'playlists';

interface FaceTone {
  palette: string[] | null;
  weights: number[] | undefined;
}

let shelf: ReturnType<typeof createShelf> | null = null;
let browserVisible = false;
let active = false;
let lens: Lens = 'artists';
let selectedId: string | null = null;
let artistEntries: ShelfEntry[] = [];
let artistTones = new Map<string, FaceTone>();
let playlistEntries: ShelfEntry[] = [];
let playlistTones = new Map<string, FaceTone>();

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const toneOf = (track: IndexedTrack | undefined): FaceTone => ({
  palette: track?.palette ?? null,
  weights: track?.paletteWeights,
});

const byName = (a: string, b: string): number => {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la === lb ? (a < b ? -1 : a > b ? 1 : 0) : la < lb ? -1 : 1;
};

const letterBucket = (name: string): number => {
  const code = name.charAt(0).toUpperCase().charCodeAt(0);
  return code >= 65 && code <= 90 ? 0 : 1;
};

const buildArtistEntries = (): void => {
  const result = libraryStore.result;
  artistEntries = [];
  artistTones = new Map();
  if (result === null || !result.ok) return;
  interface AlbumFace {
    year: number;
    artFile: string | null;
    track: IndexedTrack | undefined;
  }
  const groups = new Map<
    string,
    { songs: number; albums: Map<string, AlbumFace> }
  >();
  for (const track of result.tracks) {
    const name = primaryOf(track);
    if (name === null || name.trim() === '') continue;
    let g = groups.get(name);
    if (g === undefined) {
      g = { songs: 0, albums: new Map() };
      groups.set(name, g);
    }
    g.songs += 1;
    const albumKey = track.album !== null && track.album.trim() !== '' ? track.album : '';
    const year = track.year ?? -1;
    const face = g.albums.get(albumKey);
    if (face === undefined) {
      g.albums.set(albumKey, { year, artFile: track.artFile, track });
    } else if (year > face.year) {
      face.year = year;
      face.artFile = track.artFile;
      face.track = track;
    }
  }
  const names = [...groups.keys()].sort((a, b) => letterBucket(a) - letterBucket(b) || byName(a, b));
  for (const name of names) {
    const g = groups.get(name);
    if (g === undefined) continue;
    let face: AlbumFace | null = null;
    for (const album of g.albums.values()) {
      if (face === null || album.year > face.year) face = album;
    }
    const tone = toneOf(face?.track);
    const entry: ShelfEntry = {
      id: `artist:${name}`,
      name,
      ledger: `${plural(g.albums.size, 'album')} · ${plural(g.songs, 'song')}`,
      art: face?.artFile != null ? mediaUrl(face.artFile) : null,
      initial: name.charAt(0).toUpperCase(),
    };
    artistEntries.push(entry);
    artistTones.set(entry.id, tone);
  }
};

const buildPlaylistEntries = (): void => {
  playlistEntries = [];
  playlistTones = new Map();
  const playlists = [...playlistsStore.list()].sort((a, b) => byName(a.name, b.name));
  for (const pl of playlists) {
    const resolved = playlistsStore.resolve(pl.tracks);
    const first = resolved.find((r): r is { track: IndexedTrack } => 'track' in r);
    const tone = toneOf(first?.track);
    const entry: ShelfEntry = {
      id: `playlist:${pl.id}`,
      name: pl.name,
      ledger: plural(pl.tracks.length, 'song'),
      art: first?.track.artFile != null ? mediaUrl(first.track.artFile) : null,
      initial: pl.name.charAt(0).toUpperCase(),
    };
    playlistEntries.push(entry);
    playlistTones.set(entry.id, tone);
  }
};

const currentEntries = (): ShelfEntry[] => (lens === 'artists' ? artistEntries : playlistEntries);

const currentTones = (): Map<string, FaceTone> => (lens === 'artists' ? artistTones : playlistTones);

const focusIndex = (): number => {
  const entries = currentEntries();
  const n = entries.length;
  if (n === 0) return 0;
  if (lens === 'artists') {
    const cur = player.currentTrack;
    if (cur !== null) {
      const name = primaryOf(cur);
      if (name !== null) {
        const idx = entries.findIndex((e) => e.name === name);
        if (idx >= 0) return idx;
      }
    }
  }
  return Math.floor(Math.random() * n);
};

const applyEntries = (): void => {
  if (shelf === null) return;
  shelf.setEntries(currentEntries());
  shelf.scrollTo(focusIndex());
};

const pushTone = (): void => {
  if (selectedId === null) return;
  const tone = currentTones().get(selectedId);
  if (tone === undefined) return;
  uiTheme.pushSelection(tone.palette, tone.weights);
};

const highlight = (index: number): void => {
  const entry = currentEntries()[index];
  if (entry === undefined) {
    selectedId = null;
    shelf?.setSelected(null);
    uiTheme.popSelection();
    return;
  }
  selectedId = entry.id;
  const tone = currentTones().get(entry.id);
  const accent = deriveAccent(tone?.palette ?? null, tone?.weights);
  shelf?.setSelected(entry.id, { ledger: accent.b, ring: accent.a, glow: accent.g });
  pushTone();
};

const setLens = (next: Lens): void => {
  if (lens === next || shelf === null) return;
  lens = next;
  syncLensButtons();
  applyEntries();
};

let lensButtons: { artists: HTMLButtonElement; playlists: HTMLButtonElement } | null = null;

const syncLensButtons = (): void => {
  if (lensButtons === null) return;
  lensButtons.artists.classList.toggle('on', lens === 'artists');
  lensButtons.playlists.classList.toggle('on', lens === 'playlists');
};

const buildLensSwitcher = (root: HTMLElement): void => {
  const nav = document.createElement('nav');
  nav.id = 'shelf-lens';
  const artists = document.createElement('button');
  artists.type = 'button';
  artists.textContent = 'Artists';
  const playlists = document.createElement('button');
  playlists.type = 'button';
  playlists.textContent = 'Playlists';
  artists.addEventListener('click', () => setLens('artists'));
  playlists.addEventListener('click', () => setLens('playlists'));
  nav.append(artists, playlists);
  root.append(nav);
  lensButtons = { artists, playlists };
  syncLensButtons();
};

const currentRegion = (): ShelfRegion => ({
  x: 0,
  y: BEZEL_H,
  width: window.innerWidth,
  height: Math.max(240, window.innerHeight - BEZEL_H - TIMELINE_H),
});

const applyVisibility = (): void => {
  active = browserVisible;
  shelf?.setVisible(active);
  document.body.classList.toggle('shelf-active', active);
  if (!active) {
    uiTheme.popSelection();
  } else {
    pushTone();
  }
};

export const shelfSurface = {
  setBrowserVisible(next: boolean): void {
    if (browserVisible === next) return;
    browserVisible = next;
    applyVisibility();
  },
};

export function initShelfSurface(): void {
  if (shelf !== null) return;
  shelf = createShelf();
  shelf.onEntryTap((id) => {
    if (!active) return;
    const idx = currentEntries().findIndex((e) => e.id === id);
    if (idx < 0 || idx === shelf?.centerIndex()) return;
    highlight(idx);
    shelf?.glideTo(idx);
  });
  shelf.onSettle((index) => {
    if (!active) return;
    highlight(index);
  });
  shelf.mount(currentRegion(), window.devicePixelRatio || 1);
  const rootEl = document.getElementById('shelf');
  if (rootEl !== null) buildLensSwitcher(rootEl);
  buildArtistEntries();
  buildPlaylistEntries();
  applyEntries();
  applyVisibility();

  window.addEventListener('resize', () => {
    shelf?.setRegion(currentRegion(), window.devicePixelRatio || 1);
  });

  libraryStore.onChange(() => {
    buildArtistEntries();
    if (lens === 'artists') applyEntries();
  });

  playlistsStore.onChange(() => {
    buildPlaylistEntries();
    if (lens === 'playlists') applyEntries();
  });

  (window as unknown as { __shelf?: unknown }).__shelf = {
    visible: () => active,
    lens: () => lens,
    names: () => currentEntries().map((e) => e.name),
    entries: () => currentEntries(),
    scroll: () => shelf?.scrollPosition() ?? 0,
    center: () => shelf?.centerIndex() ?? 0,
    selected: () => selectedId,
    cards: () => shelf?.cardsState() ?? [],
    rect: (id: string) => shelf?.entryRect(id) ?? null,
    goto: (index: number) => shelf?.scrollTo(index),
  };
}
