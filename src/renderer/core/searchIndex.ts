import type { IndexedTrack } from '../../shared/types';
import { fold } from './fold';
import { basenameOf } from './paths';

export interface AlbumEntry {
  key: string;
  name: string;
  artist: string;
  artFile: string | null;
  palette: string[] | null;
  tracks: IndexedTrack[];
  totalDuration: number;
  year: number | null;
  hay: string;
}

export interface ArtistEntry {
  key: string;
  name: string;
  albums: AlbumEntry[];
  trackCount: number;
  totalDuration: number;
  artFile: string | null;
  hay: string;
}

export interface SongEntry {
  track: IndexedTrack;
  hay: string;
}

export interface SearchIndexes {
  songs: SongEntry[];
  albums: AlbumEntry[];
  artists: ArtistEntry[];
}

const UNKNOWN_ARTIST = 'Unknown Artist';
const UNKNOWN_ALBUM = 'Unknown Album';

export function buildSearchIndexes(tracks: readonly IndexedTrack[]): SearchIndexes {
  const albumMap = new Map<string, AlbumEntry>();

  const songs: SongEntry[] = tracks.map((track) => ({
    track,
    hay: fold(
      `${track.title} ${track.artist ?? ''} ${track.album ?? ''} ${track.fileName}`,
    ),
  }));

  for (const track of tracks) {
    const artistName = track.albumArtist ?? track.artist ?? UNKNOWN_ARTIST;
    const albumName = track.album ?? folderHint(track.relPath) ?? UNKNOWN_ALBUM;
    const key = `${artistName.toLowerCase()}::${albumName.toLowerCase()}`;

    let album = albumMap.get(key);
    if (album === undefined) {
      album = {
        key,
        name: albumName,
        artist: artistName,
        artFile: null,
        palette: null,
        tracks: [],
        totalDuration: 0,
        year: null,
        hay: '',
      };
      albumMap.set(key, album);
    }

    album.tracks.push(track);
    if (album.artFile === null && track.artFile !== null) album.artFile = track.artFile;
    if (album.palette === null && track.palette !== null) album.palette = track.palette;
    if (album.year === null && track.year !== null) album.year = track.year;
    if (track.durationSec !== null) album.totalDuration += track.durationSec;
  }

  for (const album of albumMap.values()) {
    album.tracks.sort((a, b) => compareNullable(a.discNo, b.discNo) || compareNullable(a.trackNo, b.trackNo) || a.title.localeCompare(b.title));
    const trackTitles = album.tracks.map((t) => t.title).join(' ');
    album.hay = fold(`${album.name} ${album.artist} ${trackTitles}`);
  }

  const albums = Array.from(albumMap.values());

  const artistMap = new Map<string, ArtistEntry>();
  for (const album of albums) {
    const key = album.artist.toLowerCase();
    let artist = artistMap.get(key);
    if (artist === undefined) {
      artist = {
        key,
        name: album.artist,
        albums: [],
        trackCount: 0,
        totalDuration: 0,
        artFile: null,
        hay: '',
      };
      artistMap.set(key, artist);
    }
    artist.albums.push(album);
    artist.trackCount += album.tracks.length;
    artist.totalDuration += album.totalDuration;
    if (artist.artFile === null && album.artFile !== null) artist.artFile = album.artFile;
  }

  for (const artist of artistMap.values()) {
    artist.hay = fold(`${artist.name} ${artist.albums.map((a) => a.name).join(' ')}`);
  }

  return { songs, albums, artists: Array.from(artistMap.values()) };
}

function folderHint(relPath: string): string | null {
  const parts = relPath.split('/');
  if (parts.length < 2) return null;
  const dir = parts[parts.length - 2];
  return dir !== undefined ? basenameOf(dir) : null;
}

function compareNullable(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

export function fmtTotal(seconds: number): string {
  if (seconds <= 0) return '--';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} hr ${m} min`;
}
