import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { LyricsPayload, LyricsResult } from '../shared/types';

const LRCLIB_GET = 'https://lrclib.net/api/get';
const LRCLIB_SEARCH = 'https://lrclib.net/api/search';
const USER_AGENT = 'MotiveRevival/0.1.0 (local desktop player)';
const TIMEOUT_MS = 9000;

const memory = new Map<string, LyricsResult>();
const inflight = new Map<string, Promise<LyricsResult>>();

export async function resolveLyrics(
  payload: LyricsPayload,
  allowFetch: boolean,
  allowWrite: boolean,
): Promise<LyricsResult> {
  const key = payload.absPath;
  const cached = memory.get(key);
  if (cached !== undefined) return cached;
  const running = inflight.get(key);
  if (running !== undefined) return running;

  const task = (async (): Promise<LyricsResult> => {
    const result = await doResolve(payload, allowFetch, allowWrite);
    if (memory.size > 400) memory.clear();
    memory.set(key, result);
    return result;
  })();

  inflight.set(key, task);
  void task.catch(() => undefined).finally(() => inflight.delete(key));
  return task;
}

async function doResolve(
  payload: LyricsPayload,
  allowFetch: boolean,
  allowWrite: boolean,
): Promise<LyricsResult> {
  const local = await readLocalSheet(payload.absPath);
  if (local !== null) {
    return { ok: true, synced: true, text: local, source: 'file', written: false };
  }

  if (!allowFetch) {
    return { ok: false, error: 'No local lyrics sheet.' };
  }

  const fetched = await fetchFromLrclib(payload);
  if (fetched === null) {
    return { ok: false, error: 'lrclib had no matching sheet.' };
  }

  if (fetched.syncedText !== null) {
    const written = allowWrite ? await writeBeside(payload.absPath, fetched.syncedText) : false;
    return { ok: true, synced: true, text: fetched.syncedText, source: 'lrclib', written };
  }
  if (fetched.plainText !== null && fetched.plainText.trim() !== '') {
    return { ok: true, synced: false, text: fetched.plainText, source: 'lrclib', written: false };
  }
  return { ok: false, error: 'Match found without lyrics.' };
}

async function readLocalSheet(absPath: string): Promise<string | null> {
  try {
    const dir = dirname(absPath);
    const fileName = basename(absPath);
    const stem = fileName.slice(0, fileName.length - extname(fileName).length).toLowerCase() + '.lrc';
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      if (entry.toLowerCase() === stem) {
        return await fs.readFile(join(dir, entry), 'utf8');
      }
    }
  } catch {
    return null;
  }
  return null;
}

interface FetchedLyrics {
  syncedText: string | null;
  plainText: string | null;
}

async function fetchFromLrclib(payload: LyricsPayload): Promise<FetchedLyrics | null> {
  const params = new URLSearchParams({
    track_name: payload.title,
    artist_name: payload.artist ?? '',
  });
  if (payload.album !== null) params.set('album_name', payload.album);
  if (payload.durationSec !== null && payload.durationSec > 0) {
    params.set('duration', String(Math.round(payload.durationSec)));
  }

  try {
    const getUrl = `${LRCLIB_GET}?${params.toString()}`;
    const getRes = await httpGetJson(getUrl);
    const getPicked = getRes === null ? null : pickFetched(getRes);
    if (getPicked !== null && getPicked.syncedText !== null) return getPicked;

    const searchUrl = `${LRCLIB_SEARCH}?${params.toString()}`;
    const searchRes = await httpGetJson(searchUrl);
    if (Array.isArray(searchRes) && searchRes.length > 0) {
      const want = payload.durationSec ?? 0;
      const ranked = [...searchRes].sort((a, b) => rank(b, want) - rank(a, want));
      for (const item of ranked) {
        const picked = pickFetched(item);
        if (picked !== null && picked.syncedText !== null) return picked;
      }
    }

    return getPicked;
  } catch {
    return null;
  }
}

function rank(item: unknown, wantDuration: number): number {
  const rec = item as { syncedLyrics?: unknown; duration?: unknown };
  let score = typeof rec.syncedLyrics === 'string' && rec.syncedLyrics !== '' ? 1000 : 0;
  if (typeof rec.duration === 'number' && wantDuration > 0) {
    score -= Math.min(Math.abs(rec.duration - wantDuration), 60);
  }
  return score;
}

function pickFetched(item: unknown): FetchedLyrics | null {
  const rec = item as { syncedLyrics?: unknown; plainLyrics?: unknown };
  const syncedText = typeof rec.syncedLyrics === 'string' && rec.syncedLyrics.trim() !== '' ? rec.syncedLyrics : null;
  const plainText = typeof rec.plainLyrics === 'string' ? rec.plainLyrics : null;
  if (syncedText === null && plainText === null) return null;
  return { syncedText, plainText };
}

async function httpGetJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return response.json();
}

async function writeBeside(absPath: string, sheetText: string): Promise<boolean> {
  try {
    const dir = dirname(absPath);
    const fileName = basename(absPath);
    const stem = fileName.slice(0, fileName.length - extname(fileName).length);
    await fs.writeFile(join(dir, `${stem}.lrc`), sheetText, 'utf8');
    return true;
  } catch {
    return false;
  }
}
