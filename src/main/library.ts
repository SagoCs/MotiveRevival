import { app, nativeImage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync, promises as fs } from 'node:fs';
import { extname, dirname, join, relative, sep } from 'node:path';
import { parseFile, type IPicture, type ICommonTagsResult } from 'music-metadata';
import type { IndexedTrack, LibraryResult } from '../shared/types';

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.oga', '.wav', '.m4a', '.aac', '.opus']);
const MAX_DEPTH = 12;
const CONCURRENCY = 8;
const INDEX_VERSION = 7;

const CREDIT_SPLIT = /\s*[;,]\s*|\s+feat\.?\s+|\s+ft\.\s*|\s+featuring\s+/i;

function splitCredit(credit: string): string[] {
  return credit
    .split(CREDIT_SPLIT)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

function hasCreditSeparator(credit: string): boolean {
  return splitCredit(credit).length > 1;
}

function primaryFromCredit(credit: string): string | null {
  const parts = splitCredit(credit);
  const first = parts[0];
  if (first === undefined || parts.length < 2) return null;
  return first;
}

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

  const known = new Set<string>();
  for (const t of tracks) {
    if (t.artist !== null && !hasCreditSeparator(t.artist)) known.add(t.artist.toLowerCase());
    const p = t.primaryArtist;
    if (p != null) known.add(p.toLowerCase());
  }
  for (const t of tracks) {
    if (t.artist === null || t.primaryArtist == null) continue;
    if (known.has(t.primaryArtist.toLowerCase())) continue;
    for (const part of splitCredit(t.artist).slice(1)) {
      if (known.has(part.toLowerCase())) {
        t.primaryArtist = part;
        break;
      }
    }
  }

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
    const extracted = artFile !== null ? extractPalette(artFile) : null;

    const duration = meta.format.duration;
    const artistCredit = clean(common.artist);
    return {
      ...base,
      title: clean(common.title) ?? stripExt(base.fileName),
      artist: artistCredit,
      primaryArtist: artistCredit !== null ? primaryFromCredit(artistCredit) : null,
      albumArtist: clean(common.albumartist) ?? clean(common.artist),
      album: clean(common.album),
      trackNo: common.track?.no ?? null,
      discNo: common.disk?.no ?? null,
      year: common.year ?? null,
      bpm: typeof common.bpm === 'number' && Number.isFinite(common.bpm) ? Math.round(common.bpm) : null,
      durationSec: duration !== undefined && Number.isFinite(duration) ? duration : null,
      artFile,
      palette: extracted?.colors ?? null,
      paletteWeights: extracted?.weights,
    };
  } catch {
    return {
      ...base,
      title: stripExt(base.fileName),
      artist: null,
      primaryArtist: null,
      albumArtist: null,
      album: null,
      trackNo: null,
      discNo: null,
      year: null,
      bpm: null,
      durationSec: null,
      artFile: folderFallbackArt(dirname(fullPath), fallbackCache),
      palette: null,
    };
  }
}

function extractPalette(artPath: string): { colors: string[]; weights: number[] } | null {
  try {
    const img = nativeImage.createFromPath(artPath);
    if (img.isEmpty()) return null;
    const small = img.resize({ width: 64, height: 64 });
    const buf = small.toBitmap();
    const len = buf.length - (buf.length % 4);
    const total = len / 4;
    if (total === 0) return null;

    interface Bucket { n: number; r: number; g: number; b: number }
    const buckets = new Map<number, Bucket>();

    for (let i = 0; i < len; i += 4) {
      const b = buf[i];
      const g = buf[i + 1];
      const r = buf[i + 2];
      if (r === undefined || g === undefined || b === undefined) continue;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
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

    interface Candidate { r: number; g: number; b: number; share: number; chroma: number }
    const candidates: Candidate[] = [];
    for (const bucket of buckets.values()) {
      const r = Math.round(bucket.r / bucket.n);
      const g = Math.round(bucket.g / bucket.n);
      const b = Math.round(bucket.b / bucket.n);
      const mx = Math.max(r, g, b) / 255;
      const mn = Math.min(r, g, b) / 255;
      const l = (mx + mn) / 2;
      const s = mx === mn ? 0 : l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
      candidates.push({ r, g, b, share: bucket.n / total, chroma: (1 - Math.abs(2 * l - 1)) * s * 100 });
    }

    const manhattan = (a: Candidate, c: Candidate): number =>
      Math.abs(a.r - c.r) + Math.abs(a.g - c.g) + Math.abs(a.b - c.b);

    const byPop = [...candidates].sort((a, c) => c.share - a.share);
    const base: Candidate[] = [];
    for (const c of byPop) {
      if (base.every((p) => manhattan(p, c) >= 72)) base.push(c);
      if (base.length >= 4) break;
    }

    const vivid = candidates
      .filter((c) => c.chroma > 6 && !base.includes(c))
      .sort((a, c) => c.chroma * Math.sqrt(c.share) - a.chroma * Math.sqrt(a.share));
    const extra: Candidate[] = [];
    for (const c of vivid) {
      if (extra.every((p) => manhattan(p, c) >= 72)) extra.push(c);
      if (base.length + extra.length >= 6) break;
    }

    const picked = [...base, ...extra];
    if (picked.length === 0) return null;
    while (picked.length < 3) {
      const last = picked[picked.length - 1];
      if (last === undefined) break;
      picked.push(last);
    }
    return {
      colors: picked.map((c) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`),
      weights: picked.map((c) => c.share),
    };
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
