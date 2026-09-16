import { appBus } from '../core/appBus';
import { libraryStore } from '../core/libraryStore';
import { mediaUrl, player } from '../core/player';
import { primaryOf } from '../core/searchIndex';
import { deriveRowWash } from '../core/palette';
import { thumbOf } from '../core/dom';
import { createRiverV2 } from './riverV2';
import { openNowPlaying } from './overlay';
import { openSongMenu } from './songMenu';
import type { RiverV2Entry, RiverV2Region } from './riverV2';
import type { IndexedTrack } from '../../shared/types';

const BEZEL_H = 52;
const TIMELINE_H = 62;
const SINK_MS = 240;
const TRANSIT_RETURN_DELAY = 60;
const TRANSIT_RETURN_TOTAL = SINK_MS + TRANSIT_RETURN_DELAY + 400;
const FLOOR_DELAY_MS = 360;
const SMALL_RIVER_CARDS = 7;

let river: ReturnType<typeof createRiverV2> | null = null;
let floor: HTMLDivElement | null = null;
let floorTimer = 0;
let opened = false;
let closing = false;
let dimAlbum: string | null = null;
let artistName: string | null = null;
let feed: IndexedTrack[] = [];
let displaySwap = false;
let closeCalls = 0;

interface AlbumGroup {
  year: number;
  first: number;
  tracks: IndexedTrack[];
}

const buildFeed = (name: string): IndexedTrack[] => {
  const result = libraryStore.result;
  const collected: IndexedTrack[] = [];
  if (result === null || !result.ok) return collected;
  for (const track of result.tracks) {
    const primary = primaryOf(track);
    if (primary !== null && primary.trim() !== '' && primary === name) collected.push(track);
  }
  const albums = new Map<string, AlbumGroup>();
  collected.forEach((track, index) => {
    const key = track.album !== null && track.album.trim() !== '' ? track.album : '';
    let group = albums.get(key);
    if (group === undefined) {
      group = { year: track.year ?? -1, first: index, tracks: [] };
      albums.set(key, group);
    }
    if ((track.year ?? -1) > group.year) group.year = track.year ?? -1;
    group.tracks.push(track);
  });
  const ordered: IndexedTrack[] = [];
  const groups = [...albums.values()].sort((a, b) => b.year - a.year || a.first - b.first);
  for (const group of groups) {
    group.tracks
      .map((track, index) => ({ track, index }))
      .sort((a, b) => {
        const na = a.track.trackNo ?? Number.MAX_SAFE_INTEGER;
        const nb = b.track.trackNo ?? Number.MAX_SAFE_INTEGER;
        return na === nb ? a.index - b.index : na - nb;
      })
      .forEach(({ track }) => ordered.push(track));
  }
  return ordered;
};

const entriesFrom = (tracks: IndexedTrack[]): RiverV2Entry[] =>
  tracks.map((track) => ({
    id: track.id,
    title: track.title,
    meta: track.album !== null && track.album.trim() !== '' ? [track.album] : [],
    art: track.artFile !== null ? mediaUrl(track.artFile) : null,
    artThumb: track.artFile !== null ? mediaUrl(thumbOf(track.artFile)) : null,
    tone: deriveRowWash(track.palette, track.paletteWeights),
  }));

const toEntry = (feedIdx: number): number =>
  displaySwap ? (feedIdx === 0 ? 1 : feedIdx === 1 ? 0 : feedIdx) : feedIdx;

const entryList = (): RiverV2Entry[] => {
  const list = entriesFrom(feed);
  displaySwap = feed.length >= 2 && feed.length < SMALL_RIVER_CARDS;
  if (displaySwap) {
    const first = list[0];
    const second = list[1];
    if (first !== undefined && second !== undefined) {
      list[0] = second;
      list[1] = first;
    }
  }
  return list;
};

const currentRegion = (): RiverV2Region => ({
  x: 0,
  y: BEZEL_H,
  width: window.innerWidth,
  height: Math.max(240, window.innerHeight - BEZEL_H - TIMELINE_H),
});

const syncCommitted = (): void => {
  const cur = player.currentTrack;
  river?.setCommitted(cur !== null && feed.some((t) => t.id === cur.id) ? cur.id : null);
};

const applyDim = (album: string): void => {
  const first = feed.findIndex((t) => t.album === album);
  if (first < 0) return;
  let last = first;
  while (last + 1 < feed.length && feed[last + 1]?.album === album) last += 1;
  dimAlbum = album;
  const eFirst = toEntry(first);
  const eLast = toEntry(last);
  river?.setDimSpan(Math.min(eFirst, eLast), Math.max(eFirst, eLast));
  river?.scrollTo(eFirst);
};

const clearDim = (): void => {
  dimAlbum = null;
  river?.setDimSpan(0, null);
};

const ensureFloor = (): HTMLDivElement => {
  if (floor !== null) return floor;
  const node = document.createElement('div');
  node.id = 'artist-river-floor';
  document.body.append(node);
  floor = node;
  return node;
};

const playingFeedIndex = (): number => {
  const cur = player.currentTrack;
  if (cur === null) return -1;
  return feed.findIndex((t) => t.id === cur.id);
};

const clampScroll = (): number => river?.scrollPosition() ?? 0;

export const artistRiverSurface = {
  prebuild(name: string): boolean {
    if (artistName === name && feed.length > 0) return true;
    const tracks = buildFeed(name);
    if (tracks.length === 0) return false;
    artistName = name;
    feed = tracks;
    dimAlbum = null;
    river?.setEntries(entryList());
    const playing = playingFeedIndex();
    river?.scrollTo(toEntry(playing >= 0 ? playing : 0));
    syncCommitted();
    river?.setVisible(true);
    document.getElementById('artist-river')?.classList.add('pre');
    return true;
  },
  open(name: string, opts?: { dimToAlbum?: string; focusTrackId?: string }): boolean {
    const fresh = !opened || artistName !== name;
    if (artistName !== name || feed.length === 0) {
      const tracks = buildFeed(name);
      if (tracks.length === 0) return false;
      artistName = name;
      feed = tracks;
      dimAlbum = null;
      river?.setEntries(entryList());
    }
    const playing = playingFeedIndex();
    river?.scrollTo(playing >= 0 ? toEntry(playing) : toEntry(0));
    if (opts?.focusTrackId !== undefined) {
      const fi = feed.findIndex((t) => t.id === opts.focusTrackId);
      if (fi >= 0) river?.scrollTo(toEntry(fi));
    }
    syncCommitted();
    opened = true;
    closing = false;
    const el = document.getElementById('artist-river');
    river?.setVisible(true);
    if (fresh && el !== null) {
      el.classList.add('pre');
      void el.offsetWidth;
      el.classList.remove('pre');
      if (floorTimer !== 0) window.clearTimeout(floorTimer);
      floorTimer = window.setTimeout(() => {
        floorTimer = 0;
        if (opened && !closing) ensureFloor().classList.add('on');
      }, FLOOR_DELAY_MS);
    }
    if (opts?.dimToAlbum !== undefined && opts.dimToAlbum !== null) applyDim(opts.dimToAlbum);
    appBus.emit('artist-river-opened', { artist: name });
    return true;
  },
  openDim(name: string, album: string): boolean {
    return this.open(name, { dimToAlbum: album });
  },
  removeDim(): boolean {
    if (dimAlbum === null) return false;
    clearDim();
    return true;
  },
  albumStep(dir: 1 | -1, repeat = false): void {
    if (!opened || feed.length === 0) return;
    if (repeat) {
      river?.stepHold(dir);
      return;
    }
    const n = feed.length;
    const current = ((Math.round(clampScroll()) % n) + n) % n;
    const bounds: number[] = [0];
    for (let i = 1; i < feed.length; i++) {
      if (feed[i]?.album !== feed[i - 1]?.album) bounds.push(i);
    }
    const entryBounds = bounds.map(toEntry).sort((a, b) => a - b);
    let target: number;
    if (dir === 1) {
      const next = entryBounds.find((b) => b > current + 0.01);
      if (next === undefined) return;
      target = next;
    } else {
      const below = entryBounds.filter((b) => b < current - 0.01);
      if (below.length === 0) return;
      target = below[below.length - 1] ?? 0;
    }
    river?.glideTo(target);
  },
  arrowStep(dir: 1 | -1, repeat = false): void {
    if (!opened) return;
    if (repeat) river?.stepHold(dir);
    else river?.step(dir);
  },
  arrowRelease(): void {
    if (!opened) return;
    river?.stepRelease();
  },
  activateCenter(): void {
    if (!opened) return;
    const id = river?.centerId() ?? null;
    if (id === null) return;
    const track = feed.find((t) => t.id === id);
    if (track === undefined) return;
    const cur = player.currentTrack;
    if (cur === null || cur.absPath !== track.absPath) {
      player.playSingle(track);
      syncCommitted();
    } else {
      openNowPlaying();
    }
  },
  close(): boolean {
    closeCalls += 1;
    if (!opened || closing) return false;
    closing = true;
    if (floorTimer !== 0) {
      window.clearTimeout(floorTimer);
      floorTimer = 0;
    }
    floor?.classList.remove('on');
    document.getElementById('artist-river')?.classList.add('sinking');
    window.setTimeout(() => {
      river?.setVisible(false);
      document.getElementById('artist-river')?.classList.remove('sinking');
      document.getElementById('artist-river')?.classList.remove('pre');
      opened = false;
      dimAlbum = null;
      const name = artistName;
      artistName = null;
      feed = [];
      appBus.emit('artist-river-closed', { artist: name ?? '' });
      window.setTimeout(() => {
        closing = false;
      }, TRANSIT_RETURN_TOTAL);
    }, SINK_MS);
    return true;
  },
  isOpen(): boolean {
    return opened;
  },
};

export function initArtistRiverSurface(): void {
  if (river !== null) return;
  river = createRiverV2();
  river.setLayout({ ring: true, smallSetPin: false });
  river.onHome(() => {
    const idx = playingFeedIndex();
    river?.glideTo(toEntry(idx >= 0 ? idx : 0));
  });
  river.onEntryActivated((id) => {
    if (!opened) return;
    const track = feed.find((t) => t.id === id);
    if (track === undefined) return;
    if (dimAlbum !== null && track.album !== dimAlbum) return;
    const cur = player.currentTrack;
    if (cur === null || cur.absPath !== track.absPath) {
      player.playSingle(track);
      syncCommitted();
    } else {
      openNowPlaying();
    }
  });
  river.onEntryContext((id, card) => {
    if (!opened) return;
    const track = feed.find((t) => t.id === id);
    if (track === undefined) return;
    openSongMenu({ track, host: card, row: null });
  });
  river.mount(currentRegion(), window.devicePixelRatio || 1, 'artist-river');
  river.setVisible(false);

  window.addEventListener('resize', () => {
    river?.setRegion(currentRegion(), window.devicePixelRatio || 1);
  });

  appBus.on('track-selected', () => {
    if (opened) syncCommitted();
  });

  libraryStore.onChange(() => {
    if (!opened || artistName === null) return;
    feed = buildFeed(artistName);
    river?.setEntries(entryList());
    const playing = playingFeedIndex();
    river?.scrollTo(playing >= 0 ? toEntry(playing) : toEntry(0));
    if (dimAlbum !== null) applyDim(dimAlbum);
    syncCommitted();
  });

  (window as unknown as { __artistRiver?: unknown }).__artistRiver = {
    open: (name: string) => artistRiverSurface.open(name),
    close: () => artistRiverSurface.close(),
    isOpen: () => opened,
    closing: () => closing,
    closeCalls: () => closeCalls,
    dimAlbum: () => dimAlbum,
    openDim: (name: string, album: string) => artistRiverSurface.openDim(name, album),
    removeDim: () => artistRiverSurface.removeDim(),
    arrowStep: (dir: 1 | -1, repeat = false) => artistRiverSurface.arrowStep(dir, repeat),
    toDisplay: (feedIdx: number) => toEntry(feedIdx),
    albumStep: (dir: 1 | -1) => artistRiverSurface.albumStep(dir),
    centerId: () => river?.centerId() ?? null,
    artist: () => artistName,
    titles: () => feed.map((t) => t.title),
    ids: () => feed.map((t) => t.id),
    albums: () => feed.map((t) => t.album),
    years: () => feed.map((t) => t.year),
    trackNos: () => feed.map((t) => t.trackNo),
    scroll: () => river?.scrollPosition() ?? 0,
  };
}
