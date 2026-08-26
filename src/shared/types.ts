export interface IndexedTrack {
  id: string;
  absPath: string;
  relPath: string;
  fileName: string;
  ext: string;
  sizeBytes: number;

  title: string;
  artist: string | null;
  albumArtist: string | null;
  album: string | null;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  durationSec: number | null;
  artFile: string | null;
  palette: string[] | null;
}

export type NowPlayingView = 'split' | 'art';

export interface Settings {
  musicDir: string;
  motionEffects?: boolean;
  autoFetchLyrics?: boolean;
  nowPlayingView?: NowPlayingView;
}

export interface LyricsPayload {
  absPath: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationSec: number | null;
}

export type LyricsResult =
  | { ok: true; synced: boolean; text: string; source: 'file' | 'lrclib'; written: boolean }
  | { ok: false; error: string };

export type LibraryResult =
  | { ok: true; root: string; tracks: IndexedTrack[] }
  | { ok: false; root: string; error: string };

export interface LibraryProgress {
  done: number;
  total: number;
}

export interface WindowControls {
  minimize(): void;
  maximize(): void;
  close(): void;
}

export interface MrApi {
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  setMusicDir(): Promise<Settings | null>;
  listTracks(): Promise<LibraryResult>;
  getLyrics(payload: LyricsPayload): Promise<LyricsResult>;
  storageGet(key: string): Promise<unknown>;
  storageSet(key: string, value: unknown): Promise<void>;
  window: WindowControls;
  onLibraryProgress(cb: (p: LibraryProgress) => void): () => void;
  onLibraryIndexed(cb: (r: LibraryResult) => void): () => void;
}
