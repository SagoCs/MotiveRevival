import { app, nativeImage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync, promises as fs } from 'node:fs';
import { extname, dirname, join, relative, sep } from 'node:path';
import { parseFile, type IPicture, type ICommonTagsResult } from 'music-metadata';
import type { IndexedTrack, LibraryResult } from '../shared/types';

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.oga', '.wav', '.m4a', '.aac', '.opus']);
const MAX_DEPTH = 12;
const CONCURRENCY = 8;
const INDEX_VERSION = 4;

const THUMB_WIDTH = 128;
const THUMB_JPEG_QUALITY = 82;

const FALLBACK_ART = [
  'cover.jpg', 'cover.png', 'folder.jpg', 'folder.png',
  'front.jpg', 'front.png', 'album.jpg', 'album.png',
];

export interface ScanContext {
  roots: string[];
  artDir: string;
  onProgress?: (done: number, total: number) => void;
}

interface CachedIndex {
  version: number;
  roots: string[];
  scannedAt: string;
  tracks: IndexedTrack[];
}

function indexPath(): string {
  return join(app.getPath('userData'), 'index.json');
}

export function artCacheDir(): string {
  return join(app.getPath('userData'), 'art');
}

export function loadCachedIndex(roots: string[]): LibraryResult | null {
  try {
    if (!existsSync(indexPath())) return null;
    const parsed = JSON.parse(readFileSync(indexPath(), 'utf8')) as CachedIndex;
    if (parsed.version !== INDEX_VERSION) return null;
    if (parsed.roots.length !== roots.length) return null;
    const same = parsed.roots.every((r, i) => r.toLowerCase() === (roots[i]?.toLowerCase() ?? ''));
    if (!same) return null;
    return { ok: true, roots: parsed.roots, tracks: parsed.tracks };
  } catch {
    return null;
  }
}

function saveIndex(index: CachedIndex): void {
  try {
    writeFileSync(indexPath(), JSON.stringify(index));
  } catch {
    return;
  }
}

export async function scanLibrary(ctx: ScanContext): Promise<LibraryResult> {
  for (const root of ctx.roots) {
    try {
      await fs.access(root);
    } catch (err) {
      return { ok: false, roots: ctx.roots, error: String(err) };
    }
  }

  mkdirSync(ctx.artDir, { recursive: true });

  const files: Array<{ path: string; root: string }> = [];
  for (const root of ctx.roots) {
    await collectAudioFiles(root, root, 0, files);
  }

  const tracks: IndexedTrack[] = [];
  const fallbackCache = new Map<string, string | null>();
  const seen = new Set<string>();
  let cursor = 0;
  const total = files.length;

  const report = (): void => ctx.onProgress?.(tracks.length, total);
  if (total === 0) {
    report();
    saveIndex({ version: INDEX_VERSION, roots: ctx.roots, scannedAt: new Date().toISOString(), tracks });
    return { ok: true, roots: ctx.roots, tracks };
  }

  const worker = async (): Promise<void> => {
    while (cursor < files.length) {
      const file = files[cursor];
      cursor += 1;
      if (file === undefined) break;
      const track = await indexFile(file.path, file.root, ctx, fallbackCache);
      const dedupeKey = `${track.relPath.toLowerCase()}|${track.sizeBytes}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      tracks.push(track);
      if (tracks.length % 25 === 0 || tracks.length === total) report();
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()));

  tracks.sort((a, b) => a.relPath.localeCompare(b.relPath));
  saveIndex({
    version: INDEX_VERSION,
    roots: ctx.roots,
    scannedAt: new Date().toISOString(),
    tracks,
  });
  return { ok: true, roots: ctx.roots, tracks };
}

async function collectAudioFiles(
  dir: string,
  root: string,
  depth: number,
  out: Array<{ path: string; root: string }>,
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= 20000) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.')) await collectAudioFiles(full, root, depth + 1, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!AUDIO_EXTS.has(extname(entry.name).toLowerCase())) continue;
    out.push({ path: full, root });
  }
}

async function indexFile(
  fullPath: string,
  root: string,
  ctx: ScanContext,
  fallbackCache: Map<string, string | null>,
): Promise<IndexedTrack> {
  const base = await baseFields(fullPath, root);
  try {
    const meta = await parseFile(fullPath, { duration: true });
    const common: ICommonTagsResult = meta.common;
    const picture = common.picture !== undefined && common.picture.length > 0 ? common.picture[0] : undefined;

    let artFile: string | null = null;
    if (picture) {
      artFile = writeAlbumArt(picture, albumKey(common), ctx.artDir);
    }
    if (artFile === null) {
      artFile = folderFallbackArt(dirname(fullPath), fallbackCache);
    }
    const palette = artFile !== null ? extractPalette(artFile) : null;

    const duration = meta.format.duration;
    return {
      ...base,
      title: clean(common.title) ?? stripExt(base.fileName),
      artist: clean(common.artist),
      albumArtist: clean(common.albumartist) ?? clean(common.artist),
      album: clean(common.album),
      trackNo: common.track?.no ?? null,
      discNo: common.disk?.no ?? null,
      year: common.year ?? null,
      durationSec: duration !== undefined && Number.isFinite(duration) ? duration : null,
      artFile,
      palette,
    };
  } catch {
    return {
      ...base,
      title: stripExt(base.fileName),
      artist: null,
      albumArtist: null,
      album: null,
      trackNo: null,
      discNo: null,
      year: null,
      durationSec: null,
      artFile: folderFallbackArt(dirname(fullPath), fallbackCache),
      palette: null,
    };
  }
}

function extractPalette(artPath: string): string[] | null {
  try {
    const img = nativeImage.createFromPath(artPath);
    if (img.isEmpty()) return null;
    const small = img.resize({ width: 32, height: 32 });
    const buf = small.toBitmap();
    const len = buf.length - (buf.length % 4);

    interface Bucket { n: number; r: number; g: number; b: number }
    const buckets = new Map<number, Bucket>();

    for (let i = 0; i < len; i += 4) {
      const b = buf[i];
      const g = buf[i + 1];
      const r = buf[i + 2];
      if (r === undefined || g === undefined || b === undefined) continue;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const cur = buckets.get(key);
      if (cur !== undefined) {
        cur.n += 1;
        cur.r += r;
        cur.g += g;
        cur.b += b;
      } else {
        buckets.set(key, { n: 1, r, g, b });
      }
    }

    const sorted = Array.from(buckets.values()).sort((a, b2) => b2.n - a.n);
    const picked: Array<{ r: number; g: number; b: number }> = [];

    for (const bucket of sorted) {
      const c = {
        r: Math.round(bucket.r / bucket.n),
        g: Math.round(bucket.g / bucket.n),
        b: Math.round(bucket.b / bucket.n),
      };
      let tooClose = false;
      for (const p of picked) {
        if (Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b) < 72) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) picked.push(c);
      if (picked.length >= 3) break;
    }

    if (picked.length === 0) return null;
    while (picked.length < 3 && picked.length > 0) {
      const last = picked[picked.length - 1];
      if (last === undefined) break;
      picked.push(last);
    }
    return picked.map((c) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  } catch {
    return null;
  }
}

interface TrackFileBase {
  id: string;
  absPath: string;
  relPath: string;
  fileName: string;
  ext: string;
  sizeBytes: number;
}

async function baseFields(fullPath: string, root: string): Promise<TrackFileBase> {
  let size = 0;
  try {
    size = (await fs.stat(fullPath)).size;
  } catch {
    size = 0;
  }
  return {
    id: fnv1a(fullPath),
    absPath: fullPath,
    relPath: relative(root, fullPath).split(sep).join('/'),
    fileName: basename(fullPath),
    ext: extname(fullPath).toLowerCase().slice(1),
    sizeBytes: size,
  };
}

function writeAlbumArt(picture: IPicture, key: string, artDir: string): string | null {
  try {
    const ext = picture.format.toLowerCase().includes('png') ? '.png' : '.jpg';
    const dest = join(artDir, `${fnv1a(key)}${ext}`);
    let freshlyWritten = false;
    if (!existsSync(dest)) {
      writeFileSync(dest, Buffer.from(picture.data));
      freshlyWritten = true;
    }
    const thumbPath = join(artDir, 'thumbs', `${fnv1a(key)}.jpg`);
    if (freshlyWritten || !existsSync(thumbPath)) {
      writeThumb(dest, thumbPath);
    }
    return dest;
  } catch {
    return null;
  }
}

function writeThumb(sourcePath: string, thumbPath: string): void {
  try {
    const img = nativeImage.createFromPath(sourcePath);
    if (img.isEmpty()) return;
    const scaled = img.resize({ width: THUMB_WIDTH });
    const bytes = scaled.toJPEG(THUMB_JPEG_QUALITY);
    mkdirSync(dirname(thumbPath), { recursive: true });
    writeFileSync(thumbPath, bytes);
  } catch {
    return;
  }
}

function albumKey(common: ICommonTagsResult): string {
  const artist = common.albumartist ?? common.artist ?? '';
  const album = common.album ?? '';
  return `${artist.toLowerCase()}::${album.toLowerCase()}`;
}

function folderFallbackArt(dir: string, cache: Map<string, string | null>): string | null {
  if (cache.has(dir)) return cache.get(dir) ?? null;
  let found: string | null = null;
  for (const name of FALLBACK_ART) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) {
      found = candidate;
      break;
    }
  }
  cache.set(dir, found);
  return found;
}

function clean(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function stripExt(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function basename(p: string): string {
  const norm = p.split(sep);
  return norm[norm.length - 1] ?? p;
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
