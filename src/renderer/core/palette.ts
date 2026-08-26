const FALLBACK_HUES = [226, 172, 258];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

export function fallbackPalette(seedText: string): string[] {
  const seed = hash(seedText);
  const baseHue = seed % 360;
  return FALLBACK_HUES.map((offset, i) => {
    const hue = (baseHue + offset * (i === 1 ? -1 : 1) + 360) % 360;
    const sat = 34 + ((seed >> (i * 3)) % 22);
    const light = i === 0 ? 46 : i === 1 ? 30 : 62;
    return hsl(hue, sat, light);
  });
}

export function applyPalette(target: HTMLElement, palette: readonly string[]): void {
  target.style.setProperty('--p1', palette[0] ?? '#7c74e0');
  target.style.setProperty('--p2', palette[1] ?? '#3d4470');
  target.style.setProperty('--p3', palette[2] ?? '#6ee7d8');
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): Hsl | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null || m[1] === undefined) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function applyLyricsInk(target: HTMLElement, palette: readonly string[] | null): void {
  let line = 'rgba(238, 240, 255, 0.66)';
  let active = '#f4f5ff';
  let glow = '#8f97e8';

  if (palette !== null && palette.length > 0) {
    const tones: Hsl[] = [];
    for (const entry of palette) {
      const converted = hexToHsl(entry);
      if (converted !== null) tones.push(converted);
    }
    if (tones.length > 0) {
      let lightest = tones[0] as Hsl | undefined;
      let dominant = tones[0] as Hsl | undefined;
      let brightestWash = false;
      let maxL = -1;
      let maxS = -1;
      for (const t of tones) {
        const weight = t.l + t.s * 0.35;
        if (weight > maxS) {
          maxS = weight;
          dominant = t;
        }
        if (t.l > maxL) {
          maxL = t.l;
          lightest = t;
        }
      }
      brightestWash = maxL > 68 && (dominant?.l ?? 0) > 55;

      if (lightest !== undefined && dominant !== undefined) {
        const hue = (lightest.h + 360) % 360;
        const domHue = (dominant.h + 360) % 360;
        if (brightestWash) {
          const sat = Math.max(30, Math.min(dominant.s, 55));
          line = `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% 26%)`;
          active = `hsl(${hue.toFixed(0)} ${(sat * 0.7).toFixed(0)}% 14%)`;
          glow = `hsl(${domHue.toFixed(0)} 55% 38%)`;
        } else {
          const sat = Math.max(28, Math.min(lightest.s * 0.6, 58));
          line = `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${Math.max(84, Math.min(92, lightest.l + 14)).toFixed(0)}% / 0.85)`;
          active = `hsl(${hue.toFixed(0)} ${(sat * 0.6).toFixed(0)}% 96%)`;
          glow = `hsl(${domHue.toFixed(0)} 70% 74%)`;
        }
      }
    }
  }

  target.style.setProperty('--lyric-line', line);
  target.style.setProperty('--lyric-active', active);
  target.style.setProperty('--lyric-glow', glow);
}
