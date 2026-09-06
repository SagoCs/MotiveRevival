import { Bus } from './bus';
import type { IndexedTrack } from '../../shared/types';

export interface AppEventMap {
  'track-selected': { track: IndexedTrack };
  'motion-flags': { lantern: boolean };
  'universe-open-album': { artist: string; album: string };
  'universe-open-artist': { name: string };
  'universe-open-playlist': { id: string };
}

export const appBus = new Bus<AppEventMap>();
