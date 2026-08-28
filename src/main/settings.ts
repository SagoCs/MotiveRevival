import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from '../shared/types';

const DEFAULT_DIRS = ['D:\\Music'];

let cache: Settings | null = null;

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function normalizeDirs(input: unknown): string[] {
  if (Array.isArray(input)) {
    const dirs = input
      .filter((d): d is string => typeof d === 'string')
      .map((d) => d.trim())
      .filter((d) => d.length > 1);
    const unique: string[] = [];
    for (const dir of dirs) {
      if (!unique.some((existing) => existing.toLowerCase() === dir.toLowerCase())) {
        unique.push(dir);
      }
    }
    if (unique.length > 0) return unique;
  }
  if (typeof input === 'string' && input.length > 1) return [input];
  return [...DEFAULT_DIRS];
}

export function getSettings(): Settings {
  if (cache !== null) return cache;
  let loaded: Partial<Settings> & { musicDir?: string } = {};
  try {
    if (existsSync(settingsPath())) {
      loaded = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<Settings> & {
        musicDir?: string;
      };
    }
  } catch {
    loaded = {};
  }

  const envDir = process.env['MOTIVE_MUSIC_DIR'];
  let musicDirs: string[];
  if (envDir !== undefined) {
    musicDirs = [envDir];
  } else if (loaded.musicDirs !== undefined) {
    musicDirs = normalizeDirs(loaded.musicDirs);
  } else if (typeof loaded.musicDir === 'string') {
    musicDirs = normalizeDirs(loaded.musicDir);
  } else {
    musicDirs = [...DEFAULT_DIRS];
  }

  cache = {
    musicDirs,
    motionEffects: loaded.motionEffects ?? true,
    motionCarousel: loaded.motionCarousel ?? true,
    motionPulse: loaded.motionPulse ?? true,
    motionMorph: loaded.motionMorph ?? true,
    autoFetchLyrics: loaded.autoFetchLyrics ?? true,
    lyricsSaveBeside: loaded.lyricsSaveBeside ?? true,
    lyricSize: loaded.lyricSize ?? 'm',
    nowPlayingView: loaded.nowPlayingView,
  };
  return cache;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const current = getSettings();
  cache = { ...current, ...patch };
  writeFileSync(settingsPath(), JSON.stringify(cache, null, 2));
  return cache;
}
