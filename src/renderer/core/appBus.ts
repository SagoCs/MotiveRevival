import { Bus } from './bus';
import type { IndexedTrack } from '../../shared/types';

export interface AppEventMap {
  'track-selected': { track: IndexedTrack };
  'motion-flags': { lantern: boolean };
  'reveal-playing': Record<string, never>;
  'song-menu-opened': { row: HTMLElement | null };
  'song-menu-closed': Record<string, never>;
  'artist-river-opened': { artist: string };
  'artist-river-closed': { artist: string };
  'playlist-river-opened': { playlistId: string };
  'playlist-river-closed': { playlistId: string };
  'queue-river-opened': Record<string, never>;
  'queue-river-closed': Record<string, never>;
}

export const appBus = new Bus<AppEventMap>();
