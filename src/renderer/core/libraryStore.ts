import { Bus } from './bus';
import type { LibraryResult } from '../../shared/types';

interface Events {
  updated: { result: LibraryResult };
}

class LibraryStore {
  private readonly bus = new Bus<Events>();
  private current: LibraryResult | null = null;

  get result(): LibraryResult | null {
    return this.current;
  }

  get tracks(): number {
    const r = this.current;
    return r !== null && r.ok ? r.tracks.length : 0;
  }

  getTrackList(): import('../../shared/types').IndexedTrack[] {
    const r = this.current;
    return r !== null && r.ok ? r.tracks : [];
  }

  set(result: LibraryResult): void {
    this.current = result;
    this.bus.emit('updated', { result });
  }

  onChange(cb: (result: LibraryResult) => void): () => void {
    return this.bus.on('updated', ({ result }) => cb(result));
  }
}

export const libraryStore = new LibraryStore();
