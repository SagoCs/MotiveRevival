import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from '../shared/types';

const DEFAULT_MUSIC_DIR = 'D:\\Music';

let cache: Settings | null = null;

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function getSettings(): Settings {
  if (cache) return cache;
  let loaded: Partial<Settings> = {};
  try {
    if (existsSync(settingsPath())) {
      loaded = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<Settings>;
    }
  } catch {
    loaded = {};
  }
  const envDir = process.env['MOTIVE_MUSIC_DIR'];
  cache = {
    musicDir: envDir ?? loaded.musicDir ?? DEFAULT_MUSIC_DIR,
    motionEffects: loaded.motionEffects ?? true,
    autoFetchLyrics: loaded.autoFetchLyrics ?? true,
  };
  return cache;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch };
  writeFileSync(settingsPath(), JSON.stringify(cache, null, 2));
  return cache;
}
