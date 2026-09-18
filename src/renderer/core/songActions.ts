import { libraryStore } from './libraryStore';
import { player } from './player';
import { playlistsStore } from './playlistsStore';
import type { IndexedTrack, Playlist } from '../../shared/types';

export type QueueOutcome = 'queued' | 'moved' | 'alreadyNext';
export type QueueAppendOutcome = 'added' | 'already';
export type FileOutcome = 'added' | 'alreadyInPlaylist' | 'missingPlaylist' | 'nameTaken';

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

export function queueAppend(track: IndexedTrack): QueueAppendOutcome {
  if (player.getUpcoming().some((t) => t.id === track.id)) return 'already';
  player.purgePlayed(track.id);
  player.appendToQueue(track);
  return 'added';
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
  return playlistsStore
    .create(name)
    .then((pl) => (pl === null ? 'nameTaken' : fileIntoPlaylist(pl.id, track)));
}

export function removePlaylist(playlistId: string): Promise<void> {
  return playlistsStore.remove(playlistId);
}

export function removePlaylistTrack(playlistId: string, index: number): Promise<void> {
  return playlistsStore.removeTrack(playlistId, index);
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
  queueAppend,
  queueUpcoming,
  queueRemoveTrack,
  queueMoveToGap,
  fileIntoPlaylist,
  createPlaylistWithTrack,
  removePlaylist,
  removePlaylistTrack,
  playlistContains,
  playlists,
  playlistsReady,
  playSingle(track: IndexedTrack): void {
    player.playSingle(track);
  },
  setContext(tracks: IndexedTrack[], index: number): void {
    player.setContext(tracks, index);
  },
  queueJumpTo(offset: number): void {
    player.jumpUpcoming(offset);
  },
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
