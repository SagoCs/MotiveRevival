import { Bus } from './bus';
import { libraryStore } from './libraryStore';
import type { IndexedTrack, Playlist, PlaylistTrackRef } from '../../shared/types';

const STORAGE_KEY = 'playlists';

export type ResolvedPlaylistEntry =
  | { track: IndexedTrack }
  | { ref: PlaylistTrackRef; missing: true };

interface Events {
  updated: { playlists: Playlist[] };
}

function isPlaylist(value: unknown): value is Playlist {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.createdAt === 'number' &&
    typeof p.updatedAt === 'number' &&
    Array.isArray(p.tracks)
  );
}

function isRef(value: unknown): value is PlaylistTrackRef {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.trackId === 'string' && typeof r.absPath === 'string';
}

function uid(): string {
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clone(p: Playlist): Playlist {
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    tracks: p.tracks.map((t) => ({ trackId: t.trackId, absPath: t.absPath })),
  };
}

class PlaylistsStore {
  private readonly bus = new Bus<Events>();
  private items: Playlist[] = [];
  private loaded = false;

  get ready(): boolean {
    return this.loaded;
  }

  list(): Playlist[] {
    return this.items.map(clone);
  }

  get(id: string): Playlist | null {
    const found = this.items.find((p) => p.id === id);
    return found === undefined ? null : clone(found);
  }

  onChange(cb: (playlists: Playlist[]) => void): () => void {
    return this.bus.on('updated', ({ playlists }) => cb(playlists));
  }

  async load(): Promise<void> {
    const raw: unknown = await window.mr.storageGet(STORAGE_KEY);
    this.items = Array.isArray(raw)
      ? raw.filter(isPlaylist).map((p) => ({
          ...clone(p),
          tracks: p.tracks.filter(isRef),
        }))
      : [];
    this.loaded = true;
    this.emit();
  }

  async create(name: string): Promise<Playlist> {
    const now = Date.now();
    const trimmed = name.trim();
    const playlist: Playlist = {
      id: uid(),
      name: trimmed === '' ? 'New Playlist' : trimmed,
      createdAt: now,
      updatedAt: now,
      tracks: [],
    };
    this.items.push(playlist);
    await this.persist();
    this.emit();
    return clone(playlist);
  }

  async rename(id: string, name: string): Promise<void> {
    const pl = this.find(id);
    if (pl === null) return;
    const trimmed = name.trim();
    if (trimmed !== '') pl.name = trimmed;
    pl.updatedAt = Date.now();
    await this.persist();
    this.emit();
  }

  async remove(id: string): Promise<void> {
    this.items = this.items.filter((p) => p.id !== id);
    await this.persist();
    this.emit();
  }

  async addTrack(playlistId: string, ref: PlaylistTrackRef): Promise<void> {
    const pl = this.find(playlistId);
    if (pl === null) return;
    pl.tracks.push({ trackId: ref.trackId, absPath: ref.absPath });
    await this.touch(playlistId);
  }

  async removeTrack(playlistId: string, index: number): Promise<void> {
    const pl = this.find(playlistId);
    if (pl === null || index < 0 || index >= pl.tracks.length) return;
    pl.tracks.splice(index, 1);
    await this.touch(playlistId);
  }

  async moveTrack(playlistId: string, index: number, delta: number): Promise<void> {
    const pl = this.find(playlistId);
    if (pl === null || delta === 0) return;
    if (index < 0 || index >= pl.tracks.length) return;
    const target = index + delta;
    if (target < 0 || target >= pl.tracks.length) return;
    const a = pl.tracks[index];
    const b = pl.tracks[target];
    if (a === undefined || b === undefined) return;
    pl.tracks[index] = b;
    pl.tracks[target] = a;
    await this.touch(playlistId);
  }

  async touch(id: string): Promise<void> {
    const pl = this.find(id);
    if (pl === null) return;
    pl.updatedAt = Date.now();
    await this.persist();
    this.emit();
  }

  resolve(tracks: readonly PlaylistTrackRef[]): ResolvedPlaylistEntry[] {
    const byId = new Map<string, IndexedTrack>();
    const byPath = new Map<string, IndexedTrack>();
    for (const track of libraryStore.getTrackList()) {
      byId.set(track.id, track);
      byPath.set(track.absPath, track);
    }
    return tracks.map((ref): ResolvedPlaylistEntry => {
      const hit = byId.get(ref.trackId) ?? byPath.get(ref.absPath);
      return hit !== undefined ? { track: hit } : { ref, missing: true };
    });
  }

  liveTracks(tracks: readonly PlaylistTrackRef[]): IndexedTrack[] {
    const out: IndexedTrack[] = [];
    for (const entry of this.resolve(tracks)) {
      if ('track' in entry) out.push(entry.track);
    }
    return out;
  }

  private find(id: string): Playlist | null {
    const found = this.items.find((p) => p.id === id);
    return found ?? null;
  }

  private async persist(): Promise<void> {
    await window.mr.storageSet(STORAGE_KEY, this.items);
  }

  private emit(): void {
    this.bus.emit('updated', { playlists: this.list() });
  }
}

export const playlistsStore = new PlaylistsStore();
