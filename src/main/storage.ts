import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type KvData = Record<string, unknown>;

let data: KvData | null = null;
let flushTimer: NodeJS.Timeout | null = null;

function kvPath(): string {
  return join(app.getPath('userData'), 'kv.json');
}

function load(): KvData {
  if (data !== null) return data;
  try {
    data = JSON.parse(readFileSync(kvPath(), 'utf8')) as KvData;
  } catch {
    data = {};
  }
  return data;
}

export function kvGet(key: string): unknown {
  return load()[key];
}

export function flushKv(): void {
  if (data === null) return;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    writeFileSync(kvPath(), JSON.stringify(data));
  } catch {
    return;
  }
}

export function kvSet(key: string, value: unknown): void {
  const store = load();
  store[key] = value;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      writeFileSync(kvPath(), JSON.stringify(store));
    } catch {
      return;
    }
  }, 400);
}
