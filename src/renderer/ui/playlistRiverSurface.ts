import { appBus } from '../core/appBus';
import { mediaUrl, player } from '../core/player';
import { deriveRowWash } from '../core/palette';
import { playlistsStore } from '../core/playlistsStore';
import { thumbOf } from '../core/dom';
import { openSongMenu } from './songMenu';
import { openNowPlaying } from './overlay';
import { createRiverV2 } from './riverV2';
import type { RiverV2Entry, RiverV2Region } from './riverV2';
import type { IndexedTrack } from '../../shared/types';

const BEZEL_H = 52;
const TIMELINE_H = 62;
const SINK_MS = 240;
const FLOOR_DELAY_MS = 360;

let river: ReturnType<typeof createRiverV2> | null = null;
let floor: HTMLDivElement | null = null;
let floorTimer = 0;
let opened = false;
let closing = false;
let playlistId: string | null = null;
let playlistName: string | null = null;
let tracks: IndexedTrack[] = [];
let closeCalls = 0;

interface DisplayItem {
  track?: IndexedTrack;
  ghostId?: string;
  title?: string;
}

const entriesFrom = (items: DisplayItem[]): RiverV2Entry[] =>
  items.map((item, i) => {
    const track = item.track;
    if (track === undefined) {
      return {
        id: item.ghostId ?? `missing:${i}`,
        title: item.title ?? 'Missing track',
        meta: [],
        art: null,
        ghost: true,
      };
    }
    const album = track.album !== null && track.album.trim() !== '' ? track.album : '';
    return {
      id: track.id,
      title: track.title,
      meta: album !== '' ? [album] : [],
      art: track.artFile !== null ? mediaUrl(track.artFile) : null,
      artThumb: track.artFile !== null ? mediaUrl(thumbOf(track.artFile)) : null,
      tone: deriveRowWash(track.palette, track.paletteWeights),
    };
  });

const displayItems = (id: string): DisplayItem[] | null => {
  const pl = playlistsStore.list().find((p) => p.id === id);
  if (pl === undefined || pl.tracks.length === 0) return null;
  return playlistsStore.resolve(pl.tracks).map((r) =>
    'track' in r ? { track: r.track } : { ghostId: `missing:${r.ref.trackId ?? r.ref.absPath}`, title: r.ref.absPath.split(/[\\/]/).pop() },
  );
};

const currentRegion = (): RiverV2Region => ({
  x: 0,
  y: BEZEL_H,
  width: window.innerWidth,
  height: Math.max(240, window.innerHeight - BEZEL_H - TIMELINE_H),
});

const syncCommitted = (): void => {
  const cur = player.currentTrack;
  river?.setCommitted(cur !== null && tracks.some((t) => t.id === cur.id) ? cur.id : null);
};

const ensureFloor = (): HTMLDivElement => {
  if (floor !== null) return floor;
  const node = document.createElement('div');
  node.id = 'playlist-river-floor';
  document.body.append(node);
  floor = node;
  return node;
};

const playingIdx = (): number => {
  const cur = player.currentTrack;
  if (cur === null) return -1;
  return tracks.findIndex((t) => t.id === cur.id);
};

const load = (id: string): boolean => {
  const items = displayItems(id);
  if (items === null) return false;
  const pl = playlistsStore.list().find((p) => p.id === id);
  if (pl === undefined) return false;
  tracks = items.flatMap((item) => (item.track !== undefined ? [item.track] : []));
  playlistId = id;
  playlistName = pl.name;
  river?.setEntries(entriesFrom(items));
  return true;
};

export const playlistRiverSurface = {
  prebuild(id: string): boolean {
    if (playlistId === id && playlistName !== null) return true;
    if (!load(id)) return false;
    const playing = playingIdx();
    river?.scrollTo(playing >= 0 ? playing : 0);
    syncCommitted();
    river?.setVisible(true);
    document.getElementById('playlist-river')?.classList.add('pre');
    return true;
  },
  open(id: string): boolean {
    const fresh = !opened || playlistId !== id;
    if (playlistId !== id || tracks.length === 0) {
      if (!load(id)) return false;
    }
    const playing = playingIdx();
    river?.scrollTo(playing >= 0 ? playing : 0);
    syncCommitted();
    opened = true;
    closing = false;
    const el = document.getElementById('playlist-river');
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
    appBus.emit('playlist-river-opened', { playlistId: id });
    return true;
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
    document.getElementById('playlist-river')?.classList.add('sinking');
    window.setTimeout(() => {
      river?.setVisible(false);
      document.getElementById('playlist-river')?.classList.remove('sinking');
      document.getElementById('playlist-river')?.classList.remove('pre');
      opened = false;
      const id = playlistId;
      playlistId = null;
      playlistName = null;
      tracks = [];
      appBus.emit('playlist-river-closed', { playlistId: id ?? '' });
      window.setTimeout(() => {
        closing = false;
      }, 700);
    }, SINK_MS);
    return true;
  },
  isOpen(): boolean {
    return opened;
  },
  activateCenter(): void {
    if (!opened) return;
    const id = river?.centerId() ?? null;
    if (id === null) return;
    this.playTrack(id);
  },
  playTrack(id: string): void {
    const idx = tracks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const cur = player.currentTrack;
    if (cur !== null && cur.id === id) {
      openNowPlaying();
      return;
    }
    player.setContext(tracks, idx);
    syncCommitted();
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
};

export function initPlaylistRiverSurface(): void {
  if (river !== null) return;
  river = createRiverV2();
  river.setLayout({ smallSetPin: false, reorder: true });
  river.onEntryReordered((from, gap) => {
    if (playlistId === null) return;
    void playlistsStore.reorderTrack(playlistId, from, gap);
  });
  river.onHome(() => {
    const idx = playingIdx();
    river?.glideTo(idx >= 0 ? idx : 0);
  });
  river.onEntryActivated((id) => {
    if (!opened) return;
    playlistRiverSurface.playTrack(id);
  });
  river.onEntryContext((id, card) => {
    if (!opened) return;
    const track = tracks.find((t) => t.id === id);
    if (track === undefined) return;
    openSongMenu({ track, host: card, row: null });
  });
  river.mount(currentRegion(), window.devicePixelRatio || 1, 'playlist-river');
  river.setVisible(false);

  window.addEventListener('resize', () => {
    river?.setRegion(currentRegion(), window.devicePixelRatio || 1);
  });

  appBus.on('track-selected', () => {
    if (opened) syncCommitted();
  });

  playlistsStore.onChange(() => {
    if (!opened || playlistId === null) return;
    const pos = river?.scrollPosition() ?? 0;
    const pl = playlistsStore.list().find((p) => p.id === playlistId);
    if (pl === undefined) {
      playlistRiverSurface.close();
      return;
    }
    if (!load(playlistId)) return;
    river?.scrollTo(pos);
    syncCommitted();
  });

  (window as unknown as { __playlistRiver?: unknown }).__playlistRiver = {
    open: (id: string) => playlistRiverSurface.open(id),
    close: () => playlistRiverSurface.close(),
    isOpen: () => opened,
    playlistId: () => playlistId,
    name: () => playlistName,
    ids: () => tracks.map((t) => t.id),
    titles: () => tracks.map((t) => t.title),
    scroll: () => river?.scrollPosition() ?? 0,
    centerId: () => river?.centerId() ?? null,
    closeCalls: () => closeCalls,
  };
}
