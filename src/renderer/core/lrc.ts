export interface LrcLine {
  timeMs: number;
  text: string;
}

export interface ParsedLrc {
  synced: boolean;
  lines: LrcLine[];
  metadata: Record<string, string>;
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[([a-zA-Z+#]{1,12}):([^\]]*)\]$/;

function fractionToMs(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const padded = raw.padEnd(3, '0');
  return parseInt(padded, 10);
}

export function parseLrc(raw: string): ParsedLrc {
  const metadata: Record<string, string> = {};
  const collected: LrcLine[] = [];
  const text = raw.replace(/^\uFEFF/, '');

  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    TIME_TAG.lastIndex = 0;
    const stamps: number[] = [];
    let lastEnd = 0;
    let match: RegExpExecArray | null;

    while ((match = TIME_TAG.exec(line)) !== null) {
      if (match.index !== lastEnd) break;
      const minutes = parseInt(match[1] ?? '0', 10);
      const seconds = parseInt(match[2] ?? '0', 10);
      stamps.push(minutes * 60_000 + seconds * 1000 + fractionToMs(match[3]));
      lastEnd = TIME_TAG.lastIndex;
    }

    if (stamps.length === 0) {
      const metaMatch = META_TAG.exec(line);
      if (metaMatch !== null) {
        const key = (metaMatch[1] ?? '').toLowerCase();
        if (key !== '') metadata[key] = (metaMatch[2] ?? '').trim();
      }
      continue;
    }

    const content = line.slice(lastEnd).trim();
    if (content === '') continue;

    for (const stamp of stamps) {
      collected.push({ timeMs: Math.max(0, stamp), text: content });
    }
  }

  let shift = 0;
  const offsetRaw = metadata['offset'];
  if (offsetRaw !== undefined && offsetRaw !== '') {
    const value = parseInt(offsetRaw, 10);
    if (Number.isFinite(value)) shift = -value;
  }
  if (shift !== 0) {
    for (const lineItem of collected) {
      lineItem.timeMs = Math.max(0, lineItem.timeMs + shift);
    }
  }

  collected.sort((a, b) => a.timeMs - b.timeMs);

  return { synced: collected.length > 0, lines: collected, metadata };
}

export function activeLineIndex(lines: readonly LrcLine[], timeMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const lineItem = lines[mid];
    if (lineItem === undefined) break;
    if (lineItem.timeMs <= timeMs) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}
