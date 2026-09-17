import '../styles/shelf.css';
import { appBus } from '../core/appBus';
import { libraryStore } from '../core/libraryStore';
import { mediaUrl, player } from '../core/player';
import { primaryOf } from '../core/searchIndex';
import { playlistsStore } from '../core/playlistsStore';
import { fold } from '../core/fold';
import { uiTheme } from '../core/uiTheme';
import { deriveAccent } from '../core/palette';
import { createShelf } from './shelf';
import { artistRiverSurface } from './artistRiverSurface';
import { playlistRiverSurface } from './playlistRiverSurface';
import type { ShelfEntry, ShelfRegion } from './shelf';
import type { IndexedTrack } from '../../shared/types';

const BEZEL_H = 52;
const TIMELINE_H = 62;
const RULER_LETTERS: string[] = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

type Lens = 'artists' | 'playlists';

interface FaceTone {
  palette: string[] | null;
  weights: number[] | undefined;
}

let shelf: ReturnType<typeof createShelf> | null = null;
let browserVisible = false;
let artistRiverOpen = false;
let playlistRiverOpen = false;
let active = false;
let lens: Lens = 'artists';
let selectedId: string | null = null;
let artistEntries: ShelfEntry[] = [];
let artistTones = new Map<string, FaceTone>();
let playlistEntries: ShelfEntry[] = [];
let playlistTones = new Map<string, FaceTone>();
let litLetters = new Set<string>();
let rulerKeys = new Map<string, HTMLButtonElement>();

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

const letterOf = (name: string): string => {
  const folded = fold(name.trim());
  const ch = (folded.charAt(0) || '#').toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
};

const letterBucket = (name: string): number => (letterOf(name) === '#' ? 1 : 0);

const awakeLetters = (): Set<string> => new Set(currentEntries().map((e) => letterOf(e.name)));

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
  const playlists = [...playlistsStore.list()].sort(
    (a, b) => letterBucket(a.name) - letterBucket(b.name) || byName(a.name, b.name),
  );
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
      ref: pl.id,
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
  const entries = currentEntries();
  shelf.setEntries(entries);
  let target = focusIndex();
  if (litLetters.size > 0) {
    const litIdx = entries.findIndex((e) => litLetters.has(letterOf(e.name)));
    if (litIdx >= 0) target = litIdx;
  }
  shelf.scrollTo(target);
  syncRuler();
  syncLit();
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

const syncRuler = (): void => {
  const awake = awakeLetters();
  for (const [letter, key] of rulerKeys) {
    key.classList.toggle('dead', !awake.has(letter));
    key.classList.toggle('lit', litLetters.has(letter));
  }
};

const syncLit = (): void => {
  if (shelf === null) return;
  if (litLetters.size === 0) {
    shelf.setLitIds(null);
    return;
  }
  shelf.setLitIds(currentEntries().filter((e) => litLetters.has(letterOf(e.name))).map((e) => e.id));
};

const clearLit = (): void => {
  if (litLetters.size === 0) return;
  litLetters.clear();
  syncRuler();
  syncLit();
};

const onLetterClick = (letter: string): void => {
  if (!active) return;
  if (!awakeLetters().has(letter)) return;
  if (litLetters.has(letter)) {
    litLetters.delete(letter);
    syncRuler();
    syncLit();
    return;
  }
  litLetters.add(letter);
  syncRuler();
  syncLit();
  const idx = currentEntries().findIndex((e) => letterOf(e.name) === letter);
  if (idx >= 0) shelf?.glideTo(idx);
};

const buildLetterRuler = (root: HTMLElement): void => {
  const bar = document.createElement('div');
  bar.id = 'shelf-ruler';
  for (const letter of RULER_LETTERS) {
    const key = document.createElement('button');
    key.type = 'button';
    key.className = 'shelf-ruler-key';
    key.dataset.letter = letter;
    key.textContent = letter;
    key.addEventListener('click', () => onLetterClick(letter));
    bar.append(key);
    rulerKeys.set(letter, key);
  }
  root.append(bar);
};

const setLens = (next: Lens): void => {
  if (lens === next || shelf === null) return;
  if (artistRiverOpen || playlistRiverOpen) return;
  lens = next;
  clearLit();
  syncLensButtons();
  applyEntries();
};

const currentRegion = (): ShelfRegion => ({
  x: 0,
  y: BEZEL_H,
  width: window.innerWidth,
  height: Math.max(240, window.innerHeight - BEZEL_H - TIMELINE_H),
});

const applyVisibility = (): void => {
  active = browserVisible && !artistRiverOpen && !playlistRiverOpen;
  shelf?.setVisible(browserVisible || artistRiverOpen || playlistRiverOpen);
  document.body.classList.toggle('shelf-active', active);
  if (!active) {
    pendingGesture = null;
    pendingFocus = null;
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
  clearOnEscape(): boolean {
    if (!active || litLetters.size === 0) return false;
    clearLit();
    return true;
  },
  step(dir: 1 | -1, repeat = false): void {
    if (!active) return;
    if (repeat) {
      shelf?.stepHold(dir);
      return;
    }
    if (shelf?.isBusy() === true) return;
    const entries = currentEntries();
    const n = entries.length;
    if (n === 0) return;
    const idx = shelf?.centerIndex() ?? 0;
    const next = (((idx + dir) % n) + n) % n;
    const entry = entries[next];
    if (entry === undefined) return;
    highlight(next);
    shelf?.glideTo(next);
  },
  stepRelease(): void {
    shelf?.stepRelease();
  },
  summonEnter(name: string, focus?: { dimToAlbum?: string; focusTrackId?: string }): boolean {
    if (artistRiverSurface.isOpen()) {
      artistRiverSurface.close();
      window.setTimeout(() => {
        shelfSurface.summonEnter(name, focus);
      }, 340);
      return true;
    }
    if (playlistRiverSurface.isOpen()) {
      playlistRiverSurface.close();
      window.setTimeout(() => {
        shelfSurface.summonEnter(name, focus);
      }, 340);
      return true;
    }
    if (shelf === null || !active) return false;
    shelf.cancelTransit();
    if (lens !== 'artists') setLens('artists');
    const idx = artistEntries.findIndex((e) => e.name === name);
    if (idx < 0) return false;
    const entry = artistEntries[idx];
    if (entry === undefined) return false;
    pendingFocus = focus ?? null;
    pendingGesture = { name: entry.name, idx };
    highlight(idx);
    shelf?.glideTo(idx, 1.9, 500);
    return true;
  },
  summonEnterPlaylist(id: string): boolean {
    if (artistRiverSurface.isOpen()) {
      artistRiverSurface.close();
      window.setTimeout(() => {
        shelfSurface.summonEnterPlaylist(id);
      }, 340);
      return true;
    }
    if (playlistRiverSurface.isOpen()) {
      playlistRiverSurface.close();
      window.setTimeout(() => {
        shelfSurface.summonEnterPlaylist(id);
      }, 340);
      return true;
    }
    if (shelf === null || !active) return false;
    shelf.cancelTransit();
    if (lens !== 'playlists') setLens('playlists');
    const idx = playlistEntries.findIndex((e) => e.ref === id);
    if (idx < 0) return false;
    const entry = playlistEntries[idx];
    if (entry === undefined) return false;
    pendingGesture = { name: entry.name, idx };
    highlight(idx);
    shelf?.glideTo(idx, 1.9, 500);
    return true;
  },
  activateCenter(): void {
    if (!active || shelf?.isBusy() === true) return;
    const idx = shelf?.centerIndex() ?? -1;
    const entry = currentEntries()[idx];
    if (entry === undefined) return;
    if (lens === 'playlists' && entry.ref === undefined) return;
    if (litLetters.size > 0 && !litLetters.has(letterOf(entry.name))) return;
    enterCurrent(entry, idx);
  },
};

const ENTRANCE_RISE_MS = 140;

let pendingGesture: { name: string; idx: number } | null = null;
let pendingFocus: { dimToAlbum?: string; focusTrackId?: string } | null = null;
let shelfRoot: HTMLElement | null = null;
let enteredRiver: 'artists' | 'playlists' | null = null;

const gestMark = (s: string): void => {
  const w = window as unknown as { __gestDebug?: string };
  w.__gestDebug = (w.__gestDebug ?? '') + s;
};

const enterCurrent = (entry: ShelfEntry, idx: number): void => {
  gestMark('E');
  highlight(idx);
  if (lens === 'artists') {
    artistRiverSurface.prebuild(entry.name);
  } else if (entry.ref !== undefined) {
    playlistRiverSurface.prebuild(entry.ref);
  } else {
    return;
  }
  const focus = pendingFocus;
  pendingFocus = null;
  enteredRiver = lens;
  shelf?.beginTransit(idx);
  shelfRoot?.classList.add('instruments-off');
  window.setTimeout(() => {
    if (lens === 'artists') artistRiverSurface.open(entry.name, focus ?? undefined);
    else if (entry.ref !== undefined) playlistRiverSurface.open(entry.ref);
  }, ENTRANCE_RISE_MS);
};

export function initShelfSurface(): void {
  if (shelf !== null) return;
  shelf = createShelf();
  shelf.onEntryTap((id) => {
    if (!active) return;
    const idx = currentEntries().findIndex((e) => e.id === id);
    if (idx < 0) return;
    const entry = currentEntries()[idx];
    if (entry === undefined) return;
    if (idx === shelf?.centerIndex()) {
      if (lens === 'playlists' && entry.ref === undefined) return;
      if (litLetters.size > 0 && !litLetters.has(letterOf(entry.name))) return;
      if (shelf?.isBusy() === true) return;
      enterCurrent(entry, idx);
      return;
    }
    if (litLetters.size > 0 && !litLetters.has(letterOf(entry.name))) return;
    highlight(idx);
    shelf?.glideTo(idx);
  });
  shelf.onVoidTap((taps) => {
    gestMark(String(taps));
    if (!active) {
      gestMark('i');
      return;
    }
    if (taps < 2) {
      pendingGesture = null;
      return;
    }
    if (shelf?.isBusy() === true) return;
    const cur = player.currentTrack;
    if (cur === null) return;
    const name = primaryOf(cur);
    if (name === null) return;
    const idx = artistEntries.findIndex((e) => e.name === name);
    if (idx < 0) return;
    const entry = artistEntries[idx];
    if (entry === undefined) return;
    if (taps === 2) {
      pendingGesture = null;
      if (idx === shelf?.centerIndex()) {
        highlight(idx);
        return;
      }
      highlight(idx);
      shelf?.glideTo(idx, 1.9, 500);
      return;
    }
    if (idx === shelf?.centerIndex()) {
      enterCurrent(entry, idx);
      return;
    }
    pendingGesture = { name: entry.name, idx };
    highlight(idx);
    shelf?.glideTo(idx, 1.9, 500);
  });
  shelf.onSettle((index) => {
    if (!active) return;
    const pending = pendingGesture;
    if (pending !== null) {
      pendingGesture = null;
      if (index === pending.idx) {
        const entry = currentEntries()[index];
        if (entry !== undefined && (lens === 'artists' || entry.ref !== undefined)) {
          enterCurrent(entry, index);
          return;
        }
      }
    }
    highlight(index);
  });
  shelf.mount(currentRegion(), window.devicePixelRatio || 1);
  const rootEl = document.getElementById('shelf');
  shelfRoot = rootEl;
  if (rootEl !== null) {
    buildLetterRuler(rootEl);
    buildLensSwitcher(rootEl);
  }
  buildArtistEntries();
  buildPlaylistEntries();
  applyEntries();
  applyVisibility();

  window.addEventListener('resize', () => {
    shelf?.setRegion(currentRegion(), window.devicePixelRatio || 1);
  });

  libraryStore.onChange(() => {
    buildArtistEntries();
    buildPlaylistEntries();
    for (const letter of [...litLetters]) {
      if (!awakeLetters().has(letter)) litLetters.delete(letter);
    }
    applyEntries();
  });

  playlistsStore.onChange(() => {
    buildPlaylistEntries();
    if (lens === 'playlists') {
      for (const letter of [...litLetters]) {
        if (!awakeLetters().has(letter)) litLetters.delete(letter);
      }
      applyEntries();
    }
  });

  appBus.on('artist-river-opened', () => {
    artistRiverOpen = true;
    applyVisibility();
  });

  appBus.on('playlist-river-opened', () => {
    playlistRiverOpen = true;
    applyVisibility();
  });

  appBus.on('artist-river-closed', ({ artist }) => {
    artistRiverOpen = false;
    applyVisibility();
    shelfRoot?.classList.remove('instruments-off');
    if (enteredRiver === 'artists') {
      enteredRiver = null;
      const idx = artistEntries.findIndex((e) => e.name === artist);
      if (idx >= 0) {
        shelf?.beginReturn(idx, () => {
          shelf?.glideTo(idx);
        });
      }
    } else {
      enteredRiver = null;
    }
  });

  appBus.on('playlist-river-closed', ({ playlistId }) => {
    playlistRiverOpen = false;
    applyVisibility();
    shelfRoot?.classList.remove('instruments-off');
    if (enteredRiver === 'playlists') {
      enteredRiver = null;
      const idx = playlistEntries.findIndex((e) => e.ref === playlistId);
      if (idx >= 0) {
        shelf?.beginReturn(idx, () => {
          shelf?.glideTo(idx);
        });
      }
    } else {
      enteredRiver = null;
    }
  });

  (window as unknown as { __shelf?: unknown }).__shelf = {
    visible: () => active,
    lens: () => lens,
    names: () => currentEntries().map((e) => e.name),
    entries: () => currentEntries(),
    letters: () => currentEntries().map((e) => letterOf(e.name)),
    lit: () => [...litLetters],
    scroll: () => shelf?.scrollPosition() ?? 0,
    summonEnterPlaylist: (id: string) => shelfSurface.summonEnterPlaylist(id),
    center: () => shelf?.centerIndex() ?? 0,
    selected: () => selectedId,
    cards: () => shelf?.cardsState() ?? [],
    rect: (id: string) => shelf?.entryRect(id) ?? null,
    goto: (index: number) => shelf?.scrollTo(index),
  };
}
