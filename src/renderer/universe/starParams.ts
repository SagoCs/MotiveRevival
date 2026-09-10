export const LIGHT_EXTENT = 8;

export const MOTE_MAX = 12;

export interface StarSeedInput {
  seed: number;
  hue: number;
  sat: number;
  mass: number;
  albums?: number[];
}

export interface MoteData {
  sizeNorm: number;
  speedMul: number;
  phase: number;
}

export interface StarUniforms {
  colorCore: [number, number, number];
  colorBody: [number, number, number];
  colorBloom: [number, number, number];
  glowGain: number;
  coreHeat: number;
  moteGain: number;
  moteCount: number;
  motes: MoteData[];
  worldRadius: number;
}

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seedToFloat(seed: number): number {
  return seed % 4096;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-9) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  const l = (max + min) / 2;
  const s = d <= 1e-9 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hp = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

export function toLinear(c: [number, number, number]): [number, number, number] {
  return [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];
}

function roleColor(hue: number, sat: number, dh: number, satBoost: number, satFloor: number, l: number): [number, number, number] {
  const s = Math.min(1, sat * satBoost + satFloor);
  return toLinear(hslToRgb(hue + dh, s, l));
}

function slotRoll(seed: number, slot: number): () => number {
  return mulberry32((seed ^ Math.imul(slot + 1, 0x9e3779b9)) | 0);
}

export function starRecipe(input: StarSeedInput): StarUniforms {
  const rng = mulberry32(input.seed | 0);
  const hue = input.hue;
  const sat = Math.min(0.85, Math.max(0.45, input.sat));
  const mass = Math.min(1.6, Math.max(0.45, input.mass));
  const t01 = (mass - 0.45) / 1.15;

  const colorCore = roleColor(hue, sat, 6, 1.5, 0.1, 0.5);
  const colorBody = roleColor(hue, sat, 0, 1.32, 0.06, 0.46);
  const colorBloom = roleColor(hue, sat, -10, 1.18, 0.05, 0.42);

  const massScale = 0.8 + 0.4 * t01;
  const glowGain = (0.24 + 0.14 * t01 + rng() * 0.05) * massScale;
  const coreHeat = 0.35 + rng() * 0.65;
  const moteGain = 0.5 + rng() * 0.3;

  const albumCounts =
    input.albums ??
    Array.from({ length: 6 + Math.floor(rng() * 4) }, () => 4 + Math.floor(rng() * 70));
  const motes: MoteData[] = albumCounts.slice(0, MOTE_MAX).map((count, slot) => {
    const roll = slotRoll(input.seed | 0, slot);
    const weight = Math.min(1, Math.sqrt(Math.max(0, count)) / 18);
    return {
      sizeNorm: 0.3 + 0.7 * weight,
      speedMul: 1.35 - 0.75 * weight,
      phase: roll() * Math.PI * 2,
    };
  });

  return {
    colorCore,
    colorBody,
    colorBloom,
    glowGain,
    coreHeat,
    moteGain,
    moteCount: motes.length,
    motes,
    worldRadius: mass,
  };
}

export function defaultStarUniforms(): StarUniforms {
  return starRecipe({ seed: 7, hue: 200, sat: 0.45, mass: 1.0 });
}
