import { mediaUrl } from './player';
import type { IndexedTrack } from '../../shared/types';

const PEAKS_KEY = 'waveformPeaks';
const WINDOW_SEC = 3;
const HOP_SEC = 1;
const IDLE_DELAY_MS = 1400;

const memory = new Map<string, number>();
const lazyQueue: IndexedTrack[] = [];
const idleQueue: IndexedTrack[] = [];
let busy = false;
let loaded = false;
let loadPromise: Promise<void> | null = null;
let persistTimer: number | null = null;

export function initPeakStore(): Promise<void> {
  if (loadPromise !== null) return loadPromise;
  loadPromise = (async () => {
    try {
      const stored = (await window.mr.storageGet(PEAKS_KEY)) as Record<string, number> | null;
      if (stored !== null && typeof stored === 'object') {
        for (const [key, value] of Object.entries(stored)) {
          if (typeof value === 'number' && Number.isFinite(value)) memory.set(key, value);
        }
      }
    } catch {
      /* fresh install */
    }
    loaded = true;
  })();
  return loadPromise;
}

export function fallbackOffset(track: IndexedTrack): number {
  const duration = track.durationSec;
  if (duration === null || !Number.isFinite(duration) || duration < 12) return 0;
  return Math.min(Math.max(duration * 0.38, 6), duration - 20);
}

export function getPreviewOffset(track: IndexedTrack): number {
  const known = memory.get(track.id);
  if (known !== undefined) return known;
  enqueueLazy(track);
  return fallbackOffset(track);
}

export function enqueueIdle(tracks: readonly IndexedTrack[]): void {
  for (const track of tracks) {
    if (!memory.has(track.id) && !idleQueue.some((t) => t.id === track.id)) {
      idleQueue.push(track);
    }
  }
  void pump();
}

function enqueueLazy(track: IndexedTrack): void {
  if (memory.has(track.id)) return;
  const idleIdx = idleQueue.findIndex((t) => t.id === track.id);
  if (idleIdx >= 0) idleQueue.splice(idleIdx, 1);
  if (!lazyQueue.some((t) => t.id === track.id)) lazyQueue.push(track);
  void initPeakStore().then(() => pump());
}

async function pump(): Promise<void> {
  if (busy || !loaded) return;
  const next = lazyQueue.shift() ?? idleQueue.shift();
  if (next === undefined) return;
  busy = true;
  try {
    const startSec = await analyze(next);
    if (startSec !== null) {
      memory.set(next.id, startSec);
      schedulePersist();
    }
  } catch {
    /* unanalyzable file — leave at fallback */
  } finally {
    busy = false;
  }
  if (lazyQueue.length + idleQueue.length > 0) {
    setTimeout(() => void pump(), IDLE_DELAY_MS);
  }
}

async function analyze(track: IndexedTrack): Promise<number | null> {
  try {
    const response = await fetch(mediaUrl(track.absPath));
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();

    const OfflineCtx = window.OfflineAudioContext;
    const ctx = new OfflineCtx(1, 128, 8000);
    const audio = await ctx.decodeAudioData(buffer);

    const channel = audio.getChannelData(0);
    const sampleRate = audio.sampleRate;
    const duration = audio.duration;
    if (!Number.isFinite(duration)) return null;

    const windowLen = Math.floor(Math.min(WINDOW_SEC, duration * 0.3) * sampleRate);
    if (windowLen <= 0) return 0;

    const hop = Math.floor(HOP_SEC * sampleRate);
    const count = Math.max(1, Math.floor((channel.length - windowLen) / hop) + 1);
    const stride = Math.max(16, Math.floor(windowLen / 240));

    let bestRms = -1;
    let bestStart = 0;
    for (let w = 0; w < count; w++) {
      const start = w * hop;
      const end = start + windowLen;
      let sum = 0;
      let samples = 0;
      for (let i = start; i < end; i += stride) {
        const v = channel[i] ?? 0;
        sum += v * v;
        samples += 1;
      }
      if (samples === 0) continue;
      const rms = Math.sqrt(sum / samples);
      if (rms > bestRms) {
        bestRms = rms;
        bestStart = start / sampleRate;
      }
    }

    const capped = Math.min(bestStart, Math.max(0, duration - WINDOW_SEC * 0.8));
    return Number(capped.toFixed(2));
  } catch {
    return null;
  }
}

function schedulePersist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    const obj: Record<string, number> = {};
    for (const [k, v] of memory) obj[k] = v;
    void window.mr.storageSet(PEAKS_KEY, obj);
  }, 900);
}
