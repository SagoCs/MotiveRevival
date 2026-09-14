import { appBus } from '../core/appBus';
import { libraryStore } from '../core/libraryStore';
import { mediaUrl, player } from '../core/player';
import { primaryOf } from '../core/searchIndex';
import { deriveRowWash } from '../core/palette';
import { createRiverV2 } from './riverV2';
import { openNowPlaying } from './overlay';
import { openSongMenu } from './songMenu';
import type { RiverV2Entry, RiverV2Region } from './riverV2';
import type { IndexedTrack } from '../../shared/types';

const BEZEL_H = 52;
const TIMELINE_H = 62;

let river: ReturnType<typeof createRiverV2> | null = null;
let opened = false;
let artistName: string | null = null;
let feed: IndexedTrack[] = [];

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

export const artistRiverSurface = {
  open(name: string): boolean {
    const tracks = buildFeed(name);
    if (tracks.length === 0) return false;
    artistName = name;
    feed = tracks;
    river?.setEntries(entriesFrom(tracks));
    river?.scrollTo(0);
    syncCommitted();
    opened = true;
    river?.setVisible(true);
    appBus.emit('artist-river-opened', { artist: name });
    return true;
  },
  close(): boolean {
    if (!opened) return false;
    opened = false;
    river?.setVisible(false);
    const name = artistName;
    artistName = null;
    feed = [];
    appBus.emit('artist-river-closed', { artist: name ?? '' });
    return true;
  },
  isOpen(): boolean {
    return opened;
  },
};

export function initArtistRiverSurface(): void {
  if (river !== null) return;
  river = createRiverV2();
  river.onHome(() => river?.glideTo(0));
  river.onEntryActivated((id) => {
    if (!opened) return;
    const track = feed.find((t) => t.id === id);
    if (track === undefined) return;
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
    river?.scrollTo(0);
    syncCommitted();
  });

  (window as unknown as { __artistRiver?: unknown }).__artistRiver = {
    open: (name: string) => artistRiverSurface.open(name),
    close: () => artistRiverSurface.close(),
    isOpen: () => opened,
    artist: () => artistName,
    titles: () => feed.map((t) => t.title),
    albums: () => feed.map((t) => t.album),
    years: () => feed.map((t) => t.year),
    trackNos: () => feed.map((t) => t.trackNo),
    scroll: () => river?.scrollPosition() ?? 0,
  };
}
