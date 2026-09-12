import { Bus } from './bus';
import type { IndexedTrack } from '../../shared/types';

export interface AppEventMap {
  'track-selected': { track: IndexedTrack };
  'motion-flags': { lantern: boolean };
  'universe-open-all': Record<string, never>;
  'universe-open-artist': { name: string };
  'universe-open-playlist': { id: string };
  'reveal-playing': Record<string, never>;
}

export const appBus = new Bus<AppEventMap>();
