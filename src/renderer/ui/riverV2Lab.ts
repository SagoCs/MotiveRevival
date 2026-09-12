import { libraryStore } from '../core/libraryStore';
import { mediaUrl, player } from '../core/player';
import { appBus } from '../core/appBus';
import { createRiverV2 } from './riverV2';
import { openNowPlaying } from './overlay';
import type { RiverV2Entry, RiverV2Region } from './riverV2';
import type { IndexedTrack } from '../../shared/types';

const BEZEL_H = 52;
const TIMELINE_H = 62;
const REST_CENTER = 8;

let river: ReturnType<typeof createRiverV2> | null = null;
let active = false;

const entriesFrom = (tracks: IndexedTrack[]): RiverV2Entry[] =>
  tracks.map((track) => ({
    id: track.id,
    title: track.title,
    meta: [track.artist ?? 'Unknown Artist'],
    art: track.artFile !== null ? mediaUrl(track.artFile) : null,
  }));

const currentRegion = (): RiverV2Region => ({
  x: 0,
  y: BEZEL_H,
  width: window.innerWidth,
  height: Math.max(240, window.innerHeight - BEZEL_H - TIMELINE_H),
});

const homeIndex = (): number => {
  const result = libraryStore.result;
  if (result === null || !result.ok || result.tracks.length === 0) return 0;
  const cur = player.currentTrack;
  if (cur !== null) {
    const idx = result.tracks.findIndex((t) => t.absPath === cur.absPath);
    if (idx >= 0) return idx;
  }
  return Math.min(REST_CENTER, result.tracks.length - 1);
};

const pushEntries = (): void => {
  if (river === null || !active) return;
  const result = libraryStore.result;
  if (result === null || !result.ok || result.tracks.length === 0) return;
  river.setEntries(entriesFrom(result.tracks));
  river.scrollTo(homeIndex());
  const cur = player.currentTrack;
  river.setCommitted(cur !== null ? cur.id : null);
};

export function initRiverV2Lab(): void {
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'F9') return;
    event.preventDefault();
    active = !active;
    if (active) {
      if (river === null) {
        river = createRiverV2();
        river.onHome(() => river?.glideTo(homeIndex()));
        river.onEntryActivated((id) => {
          if (river === null) return;
          const result = libraryStore.result;
          if (result === null || !result.ok) return;
          const idx = result.tracks.findIndex((t) => t.id === id);
          if (idx < 0) return;
          const track = result.tracks[idx];
          if (track === undefined) return;
          const cur = player.currentTrack;
          if (cur === null || cur.absPath !== track.absPath) {
            player.setContext(result.tracks, idx);
          } else {
            openNowPlaying();
          }
          river.setCommitted(id);
          river.glideTo(idx);
        });
      }
      river.mount(currentRegion(), window.devicePixelRatio || 1);
      pushEntries();
      river.setVisible(true);
      document.body.classList.add('river-v2-active');
    } else {
      river?.setVisible(false);
      document.body.classList.remove('river-v2-active');
    }
  });

  window.addEventListener('resize', () => {
    if (river === null || !active) return;
    river.setRegion(currentRegion(), window.devicePixelRatio || 1);
  });

  libraryStore.onChange(() => pushEntries());

  appBus.on('track-selected', ({ track }) => {
    river?.setCommitted(track.id);
  });

  (window as unknown as { __riverV2Lab?: unknown }).__riverV2Lab = {
    river: () => river,
    reload: () => pushEntries(),
    homeIndex: () => homeIndex(),
    playingId: () => player.currentTrack?.id ?? null,
  };
}
