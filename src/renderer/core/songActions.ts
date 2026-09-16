import { libraryStore } from './libraryStore';
import { player } from './player';
import { playlistsStore } from './playlistsStore';
import type { IndexedTrack, Playlist } from '../../shared/types';

export type QueueOutcome = 'queued' | 'moved' | 'alreadyNext';
export type FileOutcome = 'added' | 'alreadyInPlaylist' | 'missingPlaylist';

export function queueNext(track: IndexedTrack): QueueOutcome {
  player.purgePlayed(track.id);
  const offset = player.getUpcoming().findIndex((t) => t.id === track.id);
  if (offset === 0) return 'alreadyNext';
  if (offset > 0) {
    player.moveUpcoming(offset, 0);
    return 'moved';
  }
  player.insertUpcoming(track, 0);
  return 'queued';
}

export function queueUpcoming(): IndexedTrack[] {
  return player.getUpcoming();
}

export function queueRemoveTrack(trackId: string): boolean {
  const offset = player.getUpcoming().findIndex((t) => t.id === trackId);
  if (offset < 0) return false;
  player.removeUpcoming(offset);
  return true;
}

export function queueMoveToGap(fromOffset: number, gapOffset: number): void {
  player.moveUpcoming(fromOffset, gapOffset);
}

export function fileIntoPlaylist(playlistId: string, track: IndexedTrack): Promise<FileOutcome> {
  return playlistsStore
    .addTrack(playlistId, { trackId: track.id, absPath: track.absPath })
    .then((result) => (result === 'added' ? 'added' : result === 'present' ? 'alreadyInPlaylist' : 'missingPlaylist'));
}

export function createPlaylistWithTrack(name: string, track: IndexedTrack): Promise<FileOutcome> {
  return playlistsStore.create(name).then((pl) => fileIntoPlaylist(pl.id, track));
}

export function removePlaylist(playlistId: string): Promise<void> {
  return playlistsStore.remove(playlistId);
}

export function playlistContains(playlistId: string, trackId: string): boolean {
  const pl = playlistsStore.get(playlistId);
  return pl !== null && pl.tracks.some((t) => t.trackId === trackId);
}

export function playlists(): Playlist[] {
  return playlistsStore.list();
}

export function playlistsReady(): boolean {
  return playlistsStore.ready;
}

(window as unknown as { __songActions?: unknown }).__songActions = {
  queueNext,
  queueUpcoming,
  queueRemoveTrack,
  queueMoveToGap,
  fileIntoPlaylist,
  createPlaylistWithTrack,
  removePlaylist,
  playlistContains,
  playlists,
  playlistsReady,
  queueSnapshot(): { index: number; ids: string[]; upcoming: string[] } {
    return {
      index: player.queuePosition,
      ids: player.queueTracks.map((t) => t.id),
      upcoming: player.getUpcoming().map((t) => t.id),
    };
  },
  libraryTracks(): IndexedTrack[] {
    return libraryStore.getTrackList();
  },
};
