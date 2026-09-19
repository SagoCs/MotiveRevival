import '../styles/shelf.css';
import { appBus } from '../core/appBus';
import { libraryStore } from '../core/libraryStore';
import { mediaUrl, player } from '../core/player';
import { primaryOf } from '../core/searchIndex';
import { playlistsStore } from '../core/playlistsStore';
import { fold } from '../core/fold';
import { shakeReject } from '../core/dom';
import { uiTheme } from '../core/uiTheme';
import { deriveAccent } from '../core/palette';
import { fileIntoPlaylist } from '../core/songActions';
import { createShelf } from './shelf';
import { SHELF_PLUS_ID as PLUS_ID } from './shelf';
import { artistRiverSurface } from './artistRiverSurface';
import { playlistRiverSurface } from './playlistRiverSurface';
import { queueRiverSurface } from './queueRiverSurface';
import type { ShelfEntry, ShelfRegion } from './shelf';
import type { IndexedTrack } from '../../shared/types';

const BEZEL_H = 52;
const TIMELINE_H = 62;
const RULER_LETTERS: string[] = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
const SMALL_PIN_COUNT = 5;
const PROMPT_RISE_MS = 300;
const SPEAK_WORD_MS = 950;
const SPEAK_BACK_MS = 1150;
const RESUME_MS = 350;

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
let filing = false;
let filingTrack: IndexedTrack | null = null;
let promptOpen = false;
let instrumentsWereOff = false;
let commitPending = false;
let suspended: HTMLElement[] = [];
let speakingId: string | null = null;
let speakingWord = '';
let speakTimer = 0;
let resumeTimer = 0;
let promptEl: HTMLDivElement | null = null;
let promptInput: HTMLInputElement | null = null;
let promptWordEl: HTMLDivElement | null = null;
let promptEchoEl: HTMLDivElement | null = null;
let promptStage: 'virgin' | 'typing' | 'message' = 'virgin';
let echoTimer = 0;
let promptPartIndex = -1;
let promptRiseTimer = 0;
let floorEl: HTMLDivElement | null = null;
let lensNav: HTMLElement | null = null;
let lensTitle: HTMLDivElement | null = null;

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

const awakeLetters = (): Set<string> => new Set(realEntries().map((e) => letterOf(e.name)));

const realEntries = (): ShelfEntry[] => currentEntries().filter((e) => e.id !== PLUS_ID);

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
  playlistEntries.push({
    id: PLUS_ID,
    name: 'New Playlist',
    ledger: '',
    art: null,
    initial: '+',
  });
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
    return Math.floor(Math.random() * n);
  }
  const pool: number[] = [];
  for (let i = 0; i < n; i++) {
    if (entries[i]?.id !== PLUS_ID) pool.push(i);
  }
  if (pool.length === 0) return 0;
  return pool[Math.floor(Math.random() * pool.length)] as number;
};

const applyEntries = (forcedTarget?: number): void => {
  if (shelf === null) return;
  const entries = currentEntries();
  shelf.setEntries(entries);
  let target = forcedTarget ?? focusIndex();
  if (litLetters.size > 0) {
    const litIdx = entries.findIndex((e) => e.id !== PLUS_ID && litLetters.has(letterOf(e.name)));
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
  if (tone.palette === null) {
    uiTheme.popSelection();
    return;
  }
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
  const own = tone?.palette ?? null;
  const cur = player.currentTrack;
  const accent = deriveAccent(own ?? cur?.palette ?? null, own !== null ? tone?.weights : cur?.paletteWeights);
  shelf?.setSelected(entry.id, { ledger: accent.b, ring: accent.a, glow: accent.g });
  pushTone();
};

let lensButtons: { artists: HTMLButtonElement; playlists: HTMLButtonElement } | null = null;

const syncLensButtons = (): void => {
  if (lensButtons === null) return;
  lensButtons.artists.classList.toggle('on', lens === 'artists');
  lensButtons.playlists.classList.toggle('on', lens === 'playlists');
  lensNav?.classList.toggle('filing', filing);
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
  lensTitle = document.createElement('div');
  lensTitle.className = 'shelf-lens-title';
  lensTitle.textContent = 'Choose a playlist';
  nav.append(artists, playlists, lensTitle);
  root.append(nav);
  lensButtons = { artists, playlists };
  lensNav = nav;
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
  shelf.setLitIds(
    currentEntries()
      .filter((e) => e.id !== PLUS_ID && litLetters.has(letterOf(e.name)))
      .map((e) => e.id),
  );
};

const clearLit = (): void => {
  if (litLetters.size === 0) return;
  litLetters.clear();
  syncRuler();
  syncLit();
};

const onLetterClick = (letter: string): void => {
  if (!active || promptOpen) return;
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
  const idx = currentEntries().findIndex((e) => e.id !== PLUS_ID && letterOf(e.name) === letter);
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
  if (!filing && (artistRiverOpen || playlistRiverOpen)) return;
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
  active = filing || (browserVisible && !artistRiverOpen && !playlistRiverOpen);
  shelf?.setVisible(filing || browserVisible || artistRiverOpen || playlistRiverOpen);
  document.body.classList.toggle('shelf-active', active);
  if (!active) {
    pendingGesture = null;
    pendingFocus = null;
    uiTheme.popSelection();
  } else {
    pushTone();
  }
};

const suspendWorlds = (): void => {
  suspended = [];
  const hide = (id: string): void => {
    const el = document.getElementById(id);
    if (el === null || el.style.display === 'none') return;
    el.dataset.preFilingDisplay = el.style.display;
    el.style.display = 'none';
    suspended.push(el);
  };
  if (queueRiverSurface.isOpen()) {
    hide('queue-river');
    hide('queue-river-floor');
  }
  if (playlistRiverSurface.isOpen()) {
    hide('playlist-river');
    hide('playlist-river-floor');
  }
  if (artistRiverSurface.isOpen()) {
    hide('artist-river');
    hide('artist-river-floor');
  }
};

const resumeWorlds = (): void => {
  for (const el of suspended.splice(0)) {
    el.style.opacity = '0';
    el.style.display = el.dataset.preFilingDisplay ?? '';
    delete el.dataset.preFilingDisplay;
    window.setTimeout(() => {
      el.style.transition = 'opacity 800ms var(--ease-drift)';
      el.style.opacity = '';
      window.setTimeout(() => {
        el.style.transition = '';
      }, 840);
    }, 30);
  }
};

const beginFiling = (track: IndexedTrack): boolean => {
  if (shelf === null) return false;
  if (filing) {
    filingTrack = track;
    return true;
  }
  filingTrack = track;
  filing = true;
  instrumentsWereOff = shelfRoot?.classList.contains('instruments-off') ?? false;
  shelfRoot?.classList.remove('instruments-off');
  shelfRoot?.classList.add('filing');
  shelf.cancelTransit();
  suspendWorlds();
  floorEl?.classList.add('on');
  if (lens !== 'playlists') {
    lens = 'playlists';
    clearLit();
    applyEntries(shelf.centerIndex());
  } else {
    syncRuler();
    syncLit();
  }
  syncLensButtons();
  applyVisibility();
  highlight(shelf.centerIndex());
  return true;
};

const endFiling = (immediate = false): void => {
  if (!filing) return;
  filing = false;
  filingTrack = null;
  hideSpeak();
  closePrompt(false);
  shelf?.cancelTransit();
  promptPartIndex = -1;
  floorEl?.classList.remove('on');
  window.setTimeout(() => {
    if (!filing) {
      shelfRoot?.classList.remove('filing');
      if (instrumentsWereOff) shelfRoot?.classList.add('instruments-off');
      instrumentsWereOff = false;
      clearLit();
      syncLensButtons();
    }
  }, 850);
  window.setTimeout(() => {
    if (filing) return;
    commitPending = false;
    buildPlaylistEntries();
    applyEntries(shelf?.centerIndex() ?? 0);
  }, 870);
  applyVisibility();
  if (resumeTimer !== 0) window.clearTimeout(resumeTimer);
  if (immediate) {
    resumeWorlds();
    return;
  }
  resumeTimer = window.setTimeout(() => {
    resumeTimer = 0;
    resumeWorlds();
  }, RESUME_MS);
};

const setPromptStage = (next: 'virgin' | 'typing' | 'message'): void => {
  promptStage = next;
  promptEl?.classList.toggle('virgin', next === 'virgin');
  promptEl?.classList.toggle('typing', next === 'typing');
  promptEl?.classList.toggle('message', next === 'message');
};

const showSpeak = (id: string, word: string, holdMs: number): void => {
  window.clearTimeout(speakTimer);
  speakingId = id;
  speakingWord = word;
  shelf?.speak(id, word);
  if (holdMs > 0) {
    speakTimer = window.setTimeout(() => hideSpeak(), holdMs);
  }
};

const hideSpeak = (): void => {
  window.clearTimeout(speakTimer);
  speakingId = null;
  speakingWord = '';
  shelf?.speak(null);
};

const commitFile = (entry: ShelfEntry): void => {
  const track = filingTrack;
  const plId = entry.ref;
  if (track === null || plId === undefined) return;
  commitPending = true;
  void fileIntoPlaylist(plId, track).then((outcome) => {
    if (!filing) return;
    if (outcome === 'added') {
      showSpeak(entry.id, 'Added', 0);
      window.setTimeout(() => endFiling(), SPEAK_WORD_MS);
    } else if (outcome === 'alreadyInPlaylist') {
      showSpeak(entry.id, 'Already there', SPEAK_BACK_MS);
    } else {
      endFiling();
    }
  });
};

const openPrompt = (idx: number): void => {
  if (promptEl === null || promptInput === null || promptOpen || idx < 0) return;
  promptOpen = true;
  promptPartIndex = idx;
  if (echoTimer !== 0) {
    window.clearTimeout(echoTimer);
    echoTimer = 0;
  }
  if (promptEchoEl !== null) promptEchoEl.textContent = '';
  promptInput.value = '';
  setPromptStage('virgin');
  shelf?.beginTransit(idx);
  if (promptRiseTimer !== 0) window.clearTimeout(promptRiseTimer);
  promptRiseTimer = window.setTimeout(() => {
    promptRiseTimer = 0;
    if (!promptOpen) return;
    promptEl?.classList.add('on');
    requestAnimationFrame(() => promptInput?.focus());
  }, PROMPT_RISE_MS);
};

const closePrompt = (restore = true): void => {
  if (!promptOpen) return;
  promptOpen = false;
  if (promptRiseTimer !== 0) {
    window.clearTimeout(promptRiseTimer);
    promptRiseTimer = 0;
  }
  if (echoTimer !== 0) {
    window.clearTimeout(echoTimer);
    echoTimer = 0;
  }
  if (promptEchoEl !== null) promptEchoEl.textContent = '';
  promptEl?.classList.remove('on');
  promptInput?.blur();
  setPromptStage('virgin');
  const idx = promptPartIndex;
  promptPartIndex = -1;
  if (restore && idx >= 0) {
    shelf?.beginReturn(idx, () => {});
  }
};

const promptEscape = (): void => {
  if (promptStage === 'virgin') {
    closePrompt();
    return;
  }
  if (echoTimer !== 0) {
    window.clearTimeout(echoTimer);
    echoTimer = 0;
  }
  if (promptEchoEl !== null) promptEchoEl.textContent = '';
  if (promptInput !== null) promptInput.value = '';
  setPromptStage('virgin');
};

const finishCreate = (plId: string): void => {
  const partIdx = promptPartIndex;
  closePrompt(false);
  const idx = partIdx >= 0 ? partIdx : shelf?.centerIndex() ?? 0;
  buildPlaylistEntries();
  const newIdx = currentEntries().findIndex((e) => e.id === `playlist:${plId}`);
  const target = newIdx >= 0 ? newIdx : idx;
  shelf?.beginReturn(idx, () => {
    applyEntries(target);
    highlight(target);
  });
};

const commitPrompt = (): void => {
  if (promptInput === null || !promptOpen || promptStage === 'message') return;
  const name = promptInput.value.trim();
  if (name === '') return;
  const track = filingTrack;
  void playlistsStore.create(name).then((pl) => {
    if (pl === null) {
      if (promptEchoEl !== null) promptEchoEl.textContent = 'Name already taken';
      setPromptStage('message');
      if (echoTimer !== 0) window.clearTimeout(echoTimer);
      echoTimer = window.setTimeout(() => {
        echoTimer = 0;
        if (!promptOpen || promptStage !== 'message') return;
        if (promptEchoEl !== null) promptEchoEl.textContent = '';
        setPromptStage(promptInput !== null && promptInput.value !== '' ? 'typing' : 'virgin');
      }, 1300);
      return;
    }
    if (promptEchoEl !== null) promptEchoEl.textContent = 'Created.';
    setPromptStage('message');
    if (echoTimer !== 0) window.clearTimeout(echoTimer);
    echoTimer = window.setTimeout(() => {
      echoTimer = 0;
      if (track === null || !filing) {
        finishCreate(pl.id);
        return;
      }
      void fileIntoPlaylist(pl.id, track).then(() => {
        closePrompt(false);
        endFiling();
      });
    }, 950);
  });
};

export const shelfSurface = {
  setBrowserVisible(next: boolean): void {
    if (browserVisible === next) return;
    browserVisible = next;
    if (filing && !next) endFiling();
    applyVisibility();
  },
  isFiling(): boolean {
    return filing;
  },
  clearOnEscape(): boolean {
    if (!active) return false;
    if (promptOpen) {
      promptEscape();
      return true;
    }
    if (filing) {
      endFiling();
      return true;
    }
    if (litLetters.size === 0) return false;
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
    if (filing) endFiling(true);
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
    if (filing) endFiling(true);
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
    if (promptOpen) return;
    if (filing) {
      const focusedIdx = selectedId !== null ? currentEntries().findIndex((e) => e.id === selectedId) : -1;
      const target = focusedIdx >= 0 ? currentEntries()[focusedIdx] : entry;
      if (target === undefined) return;
      if (target.id !== PLUS_ID && litLetters.size > 0 && !litLetters.has(letterOf(target.name))) return;
      const tIdx = focusedIdx >= 0 ? focusedIdx : idx;
      highlight(tIdx);
      if (target.id === PLUS_ID) openPrompt(tIdx);
      else commitFile(target);
      return;
    }
    if (entry.id === PLUS_ID) {
      openPrompt(idx);
      return;
    }
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
    if (promptOpen) return;
    if (filing) {
      if (litLetters.size > 0 && !litLetters.has(letterOf(entry.name))) return;
      const focused = selectedId === entry.id;
      highlight(idx);
      if (!focused) {
        shelf?.glideTo(idx);
        return;
      }
      if (id === PLUS_ID) openPrompt(idx);
      else commitFile(entry);
      return;
    }
    if (id === PLUS_ID) {
      if (idx === shelf?.centerIndex() || currentEntries().length <= SMALL_PIN_COUNT) {
        highlight(idx);
        openPrompt(idx);
        return;
      }
    }
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
    if (!active || filing) {
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
    promptEl = document.createElement('div');
    promptEl.id = 'shelf-prompt';
    promptEchoEl = document.createElement('div');
    promptEchoEl.className = 'shelf-prompt-echo';
    promptWordEl = document.createElement('div');
    promptWordEl.className = 'shelf-prompt-word';
    promptWordEl.textContent = 'Choose a name';
    promptInput = document.createElement('input');
    promptInput.className = 'shelf-prompt-input';
    promptInput.spellcheck = false;
    promptInput.addEventListener('input', () => {
      if (promptStage === 'message') return;
      setPromptStage(promptInput !== null && promptInput.value !== '' ? 'typing' : 'virgin');
    });
    promptInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      commitPrompt();
    });
    promptEl.append(promptEchoEl, promptWordEl, promptInput);
    rootEl.append(promptEl);
  }
  floorEl = document.createElement('div');
  floorEl.id = 'shelf-filing-floor';
  document.body.append(floorEl);
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
    if (promptOpen || commitPending) return;
    buildPlaylistEntries();
    if (lens === 'playlists') {
      for (const letter of [...litLetters]) {
        if (!awakeLetters().has(letter)) litLetters.delete(letter);
      }
      applyEntries();
    }
  });

  appBus.on('artist-river-opened', () => {
    if (filing) endFiling(true);
    artistRiverOpen = true;
    applyVisibility();
  });

  appBus.on('playlist-river-opened', () => {
    if (filing) endFiling(true);
    playlistRiverOpen = true;
    applyVisibility();
  });

  appBus.on('queue-river-opened', () => {
    if (filing) endFiling(true);
  });

  appBus.on('summon-opened', () => {
    if (filing) endFiling();
  });

  appBus.on('file-requested', ({ track }) => {
    beginFiling(track);
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
    names: () => realEntries().map((e) => e.name),
    entries: () => realEntries(),
    letters: () => realEntries().map((e) => letterOf(e.name)),
    lit: () => [...litLetters],
    scroll: () => shelf?.scrollPosition() ?? 0,
    summonEnterPlaylist: (id: string) => shelfSurface.summonEnterPlaylist(id),
    summonEnter: (name: string) => shelfSurface.summonEnter(name),
    center: () => shelf?.centerIndex() ?? 0,
    selected: () => selectedId,
    cards: () => shelf?.cardsState() ?? [],
    rect: (id: string) => shelf?.entryRect(id) ?? null,
    goto: (index: number) => shelf?.scrollTo(index),
    filing: () => filing,
    filingTrack: () => filingTrack?.title ?? null,
    speakOn: () => speakingId !== null,
    speakWord: () => speakingWord,
    promptMessage: () => promptEchoEl?.textContent ?? null,
    prompt: () => promptOpen,
    beginFiling: (id: string) => {
      const t = libraryStore.getTrackList().find((x) => x.id === id);
      return t !== undefined ? beginFiling(t) : false;
    },
    endFiling: () => endFiling(),
  };
}
