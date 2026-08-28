import { protocol, nativeImage } from 'electron';
import { createReadStream } from 'node:fs';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

const SCHEME = 'media';

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
};

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

let allowedRoots: (() => string[]) | null = null;

export function attachMediaHandler(getRoots: () => string[]): void {
  allowedRoots = getRoots;
  protocol.handle(SCHEME, (request) => handleMediaRequest(request));
}

const THUMB_WIDTH = 128;
const THUMB_JPEG_QUALITY = 82;

async function handleMediaRequest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.host !== 'local') return textResponse(400, 'unrecognized media host');
    const decoded = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!decoded.includes(path.sep) && !decoded.includes('/')) return textResponse(400, 'malformed media path');
    const resolved = path.resolve(decoded);
    const root = resolveAllowedRoot(resolved);
    if (root === null) return textResponse(403, 'path outside music root');

    healMissingThumbnail(resolved);

    let stat;
    try {
      stat = statSync(resolved);
    } catch {
      return textResponse(404, 'track not found');
    }
    if (!stat.isFile()) return textResponse(404, 'not a file');

    const ext = path.extname(resolved).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? IMAGE_MIME_BY_EXT[ext] ?? 'application/octet-stream';
    const isImage = IMAGE_MIME_BY_EXT[ext] !== undefined;

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: baseHeaders(mime, stat.size, isImage),
      });
    }

    const rangeHeader = request.headers.get('range');
    const range = rangeHeader === null ? null : /bytes=(\d*)-(\d*)/.exec(rangeHeader);

    if (range !== null && range[1] !== undefined && range[1] !== '') {
      const start = parseInt(range[1], 10);
      const end =
        range[2] !== undefined && range[2] !== ''
          ? Math.min(parseInt(range[2], 10), stat.size - 1)
          : stat.size - 1;
      if (start > end || start >= stat.size) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.size}` },
        });
      }
      const stream = createReadStream(resolved, { start, end });
      return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
        status: 206,
        headers: {
          ...baseHeaders(mime, end - start + 1, isImage),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        },
      });
    }

    const stream = createReadStream(resolved);
    return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
      status: 200,
      headers: baseHeaders(mime, stat.size, isImage),
    });
  } catch (err) {
    return textResponse(500, `media handler error: ${String(err)}`);
  }
}

function healMissingThumbnail(resolved: string): void {
  const segments = resolved.split(path.sep);
  if (segments.length < 2) return;
  if (segments[segments.length - 2] !== 'thumbs') return;
  if (existsSync(resolved)) return;
  const stem = path.basename(resolved).replace(/\.[^.]+$/, '');
  const parentDir = path.dirname(path.dirname(resolved));
  for (const cand of ['.jpg', '.jpeg', '.png', '.webp']) {
    const original = path.join(parentDir, stem + cand);
    if (!existsSync(original)) continue;
    try {
      const img = nativeImage.createFromPath(original);
      if (img.isEmpty()) return;
      mkdirSync(path.dirname(resolved), { recursive: true });
      writeFileSync(resolved, img.resize({ width: THUMB_WIDTH }).toJPEG(THUMB_JPEG_QUALITY));
    } catch {
      return;
    }
    return;
  }
}

function resolveAllowedRoot(resolved: string): string | null {
  if (allowedRoots === null) return null;
  for (const root of allowedRoots()) {
    if (isInside(root, resolved)) return root;
  }
  return null;
}

function isInside(root: string, candidate: string): boolean {
  const normRoot = path.resolve(root);
  const normCandidate = path.resolve(candidate);
  return normCandidate === normRoot || normCandidate.startsWith(normRoot + path.sep);
}

function baseHeaders(mime: string, length: number, isImage: boolean): Record<string, string> {
  return {
    'Content-Type': mime,
    'Content-Length': String(length),
    'Accept-Ranges': 'bytes',
    'Cache-Control': isImage ? 'public, max-age=86400' : 'no-store',
  };
}

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  });
}
