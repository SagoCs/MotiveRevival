import { Bus } from './bus';
import type { IndexedTrack } from '../../shared/types';

export interface AppEventMap {
  'track-selected': { track: IndexedTrack };
}

export const appBus = new Bus<AppEventMap>();
