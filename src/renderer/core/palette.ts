const FALLBACK_HUES = [226, 172, 258];

export function deriveHorizon(palette: readonly string[] | null): { a: string; b: string; g: string } {
  const moonlit = { a: 'hsl(233 40% 19%)', b: 'hsl(172 38% 15%)', g: 'hsl(233 50% 27%)' };
  if (palette === null || palette.length === 0) {
    return moonlit;
  }
  const tones: Hsl[] = [];
  for (const entry of palette) {
    const converted = hexToHsl(entry);
    if (converted !== null) tones.push(converted);
  }
  const dominant = tones[0];
  if (dominant === undefined) {
    return moonlit;
  }
  let lightest = tones[0] as Hsl;
  for (const t of tones) {
    if (t.l > lightest.l) lightest = t;
  }
  return {
    a: hsl(((dominant.h + 360) % 360), Math.max(30, Math.min(dominant.s * 0.9, 64)), 18),
    b: hsl(((lightest.h + 360) % 360), Math.max(26, Math.min(lightest.s * 0.6, 52)), 14),
    g: hsl(((dominant.h + 360) % 360), 62, 26),
  };
}

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
  let line = 'hsl(228 32% 88% / 0.92)';
  let active = '#f6f6ff';
  let glow = '#8f97e8';

  const tones: Hsl[] = [];
  if (palette !== null && palette.length > 0) {
    for (const entry of palette) {
      const converted = hexToHsl(entry);
      if (converted !== null) tones.push(converted);
    }
  }
  const lightest = tones.reduce<Hsl | null>((best, t) => (best === null || t.l > best.l ? t : best), null);
  const dominant = tones[0];

  if (lightest !== null && dominant !== undefined) {
    const hue = (lightest.h + 360) % 360;
    const sat = Math.max(26, Math.min(lightest.s * 0.55, 48));
    line = `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% 88% / 0.92)`;
    active = `hsl(${hue.toFixed(0)} ${(sat * 0.65).toFixed(0)}% 96%)`;
    glow = `hsl(${((dominant.h + 360) % 360).toFixed(0)} 70% 74%)`;
  }

  target.style.setProperty('--lyric-line', line);
  target.style.setProperty('--lyric-active', active);
  target.style.setProperty('--lyric-glow', glow);
}

export function deriveAccent(palette: readonly string[] | null): { a: string; b: string; g: string } {
  if (palette === null || palette.length === 0) {
    return { a: '#8f97e8', b: '#6ee7d8', g: '#8f97e8' };
  }
  const tones: Hsl[] = [];
  for (const entry of palette) {
    const converted = hexToHsl(entry);
    if (converted !== null) tones.push(converted);
  }
  const dominant = tones[0];
  if (dominant === undefined || tones.length === 0) {
    return { a: '#8f97e8', b: '#6ee7d8', g: '#8f97e8' };
  }
  let lightest = tones[0] as Hsl | undefined;
  for (const t of tones) {
    if (lightest === undefined || t.l > lightest.l) lightest = t;
  }
  const deepSat = Math.max(30, Math.min(dominant.s * 0.85, 68));
  const a = `hsl(${((dominant.h + 360) % 360).toFixed(0)} ${deepSat.toFixed(0)}% ${Math.max(
    30,
    Math.min(dominant.l * 0.7 + 12, 58),
  ).toFixed(0)}%)`;
  const b =
    lightest !== undefined
      ? `hsl(${((lightest.h + 360) % 360).toFixed(0)} ${Math.max(28, Math.min(lightest.s * 0.7, 62)).toFixed(
          0,
        )}% ${Math.max(66, Math.min(lightest.l + 8, 84)).toFixed(0)}%)`
      : '#6ee7d8';
  const g = `hsl(${((dominant.h + 360) % 360).toFixed(0)} 70% 68%)`;
  return { a, b, g };
}
