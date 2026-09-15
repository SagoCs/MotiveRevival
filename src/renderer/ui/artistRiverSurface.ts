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

let river: ReturnType<typeof createRiverV2> | null = null;
let veil: HTMLDivElement | null = null;
let opened = false;
let closing = false;
let dimAlbum: string | null = null;
let artistName: string | null = null;
let feed: IndexedTrack[] = [];
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
  river?.setDimSpan(first, last);
  river?.scrollTo(first);
};

const clearDim = (): void => {
  dimAlbum = null;
  river?.setDimSpan(0, null);
};

const ensureVeil = (faceUrl: string | null): HTMLDivElement => {
  if (veil !== null) {
    const img = veil.querySelector('img');
    if (faceUrl !== null) {
      if (img === null) {
        const next = document.createElement('img');
        next.alt = '';
        next.decoding = 'async';
        veil.querySelector('.arv-zoom')?.append(next);
      }
      if (img !== null && img.getAttribute('src') !== faceUrl) img.setAttribute('src', faceUrl);
    } else if (img !== null) img.remove();
    return veil;
  }
  const node = document.createElement('div');
  node.id = 'artist-river-veil';
  const zoom = document.createElement('div');
  zoom.className = 'arv-zoom';
  if (faceUrl !== null) {
    const img = document.createElement('img');
    img.src = faceUrl;
    img.alt = '';
    img.decoding = 'async';
    zoom.append(img);
  }
  const scrim = document.createElement('div');
  scrim.className = 'arv-scrim';
  node.append(zoom, scrim);
  document.body.append(node);
  veil = node;
  return node;
};

const playingFeedIndex = (): number => {
  const cur = player.currentTrack;
  if (cur === null) return -1;
  return feed.findIndex((t) => t.id === cur.id);
};

const clampScroll = (): number => {
  const pos = river?.scrollPosition() ?? 0;
  const n = Math.max(1, feed.length);
  return ((pos % n) + n) % n;
};

export const artistRiverSurface = {
  prebuild(name: string, faceUrl: string | null): boolean {
    if (artistName === name && feed.length > 0) {
      ensureVeil(faceUrl).classList.add('on');
      return true;
    }
    const tracks = buildFeed(name);
    if (tracks.length === 0) return false;
    artistName = name;
    feed = tracks;
    dimAlbum = null;
    river?.setEntries(entriesFrom(tracks));
    const playing = playingFeedIndex();
    river?.scrollTo(playing >= 0 ? playing : 0);
    syncCommitted();
    ensureVeil(faceUrl).classList.add('on');
    river?.setVisible(true);
    document.getElementById('artist-river')?.classList.add('pre');
    return true;
  },
  warmVeil(faceUrl: string | null): void {
    const node = ensureVeil(faceUrl);
    const img = node.querySelector('img');
    if (img !== null && typeof img.decode === 'function') void img.decode().catch(() => undefined);
    node.classList.add('on');
  },
  open(name: string, faceUrl: string | null = null, dimToAlbum: string | null = null): boolean {
    if (artistName !== name || feed.length === 0) {
      const tracks = buildFeed(name);
      if (tracks.length === 0) return false;
      artistName = name;
      feed = tracks;
      dimAlbum = null;
      river?.setEntries(entriesFrom(tracks));
    }
    const playing = playingFeedIndex();
    river?.scrollTo(playing >= 0 ? playing : 0);
    syncCommitted();
    opened = true;
    closing = false;
    river?.setVisible(true);
    document.getElementById('artist-river')?.classList.remove('pre');
    ensureVeil(faceUrl).classList.add('on');
    if (dimToAlbum !== null) applyDim(dimToAlbum);
    appBus.emit('artist-river-opened', { artist: name });
    return true;
  },
  openDim(name: string, faceUrl: string | null, album: string): boolean {
    return this.open(name, faceUrl, album);
  },
  removeDim(): boolean {
    if (dimAlbum === null) return false;
    clearDim();
    return true;
  },
  albumStep(dir: 1 | -1): void {
    if (!opened || feed.length === 0) return;
    const current = Math.round(clampScroll());
    const bounds: number[] = [0];
    for (let i = 1; i < feed.length; i++) {
      if (feed[i]?.album !== feed[i - 1]?.album) bounds.push(i);
    }
    let target: number;
    if (dir === 1) {
      target = bounds.find((b) => b > current + 0.01) ?? bounds[0] ?? 0;
    } else {
      const below = bounds.filter((b) => b < current - 0.01);
      target = below.length > 0 ? below[below.length - 1] ?? 0 : bounds[bounds.length - 1] ?? 0;
    }
    river?.glideTo(target);
  },
  arrowStep(dir: 1 | -1): void {
    if (!opened) return;
    river?.step(dir);
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
    document.getElementById('artist-river')?.classList.add('sinking');
    window.setTimeout(() => {
      veil?.classList.remove('on');
    }, SINK_MS + TRANSIT_RETURN_DELAY);
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
  river.setLayout({ ring: true });
  river.onHome(() => {
    const idx = playingFeedIndex();
    river?.glideTo(idx >= 0 ? idx : 0);
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
    river?.setEntries(entriesFrom(feed));
    const playing = playingFeedIndex();
    river?.scrollTo(playing >= 0 ? playing : 0);
    if (dimAlbum !== null) applyDim(dimAlbum);
    syncCommitted();
  });

  (window as unknown as { __artistRiver?: unknown }).__artistRiver = {
    open: (name: string, faceUrl: string | null) => artistRiverSurface.open(name, faceUrl ?? null),
    close: () => artistRiverSurface.close(),
    isOpen: () => opened,
    closing: () => closing,
    closeCalls: () => closeCalls,
    dimAlbum: () => dimAlbum,
    openDim: (name: string, faceUrl: string | null, album: string) => artistRiverSurface.openDim(name, faceUrl, album),
    removeDim: () => artistRiverSurface.removeDim(),
    arrowStep: (dir: 1 | -1) => river?.step(dir),
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
