import '../styles/universe.css';
import { libraryStore } from '../core/libraryStore';
import { playlistsStore } from '../core/playlistsStore';
import { player } from '../core/player';
import { appBus } from '../core/appBus';
import { primaryOf } from '../core/searchIndex';
import type { LibraryResult, Playlist } from '../../shared/types';

const WORLD_W = 3600;
const WORLD_H = 2200;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 3;
const ZOOM_WHEEL = 0.0016;
const EASE = 0.22;
const PARK_EPSILON = 0.08;
const SEED = 20260905;
const ORBIT_MIN = 340;
const ORBIT_MAX = 700;
const ABS_WEIGHT_MAX = 300;
const WEIGHT_BANDS = [1, 8, 40, 300];
const WORLD_SQUASH = 0.85;
const RADIAL_JITTER = 0.22;
const GROWTH_CAP = 1.6;
const ARC_JITTER = 0.7;
const LABEL_MAX_SCALE = 1.5;
const MAJOR_CAP = 8;
const PIN_CAP = 8;
const PINS_KEY = 'universe:pins:v1';
const NEBULA_CAP = 6;

const DUST_HUES = [46, 268, 335, 24, 8, 288];

interface LayerSpec {
  factor: number;
  count: number;
  bright: number;
  cls: string;
}

const LAYERS: LayerSpec[] = [
  { factor: 0.35, count: 64, bright: 5, cls: 'uni-far' },
  { factor: 0.65, count: 96, bright: 7, cls: 'uni-mid' },
  { factor: 1, count: 64, bright: 6, cls: 'uni-near' },
];

interface Layer {
  el: HTMLElement;
  factor: number;
}

interface Tone {
  h: number;
  s: number;
}

interface ArtistStar {
  name: string;
  count: number;
  x: number;
  y: number;
  d: number;
  tone: Tone;
  major: boolean;
  er: number;
}

interface LabelRef {
  el: HTMLElement;
  wx: number;
  wy: number;
  d: number;
  base: string;
  hot: string | null;
}

interface LayoutNode {
  x: number;
  y: number;
  er: number;
}

interface SparkData {
  pl: Playlist;
  count: number;
  d: number;
  node: LayoutNode;
  t1: Tone;
  t2: Tone;
}

let surface: HTMLElement | null = null;
let layers: Layer[] = [];
let starsLayer: HTMLElement | null = null;
let satsLayer: HTMLElement | null = null;
let sparksLayer: HTMLElement | null = null;
let nebLayer: HTMLElement | null = null;
let orbitLayer: HTMLElement | null = null;
let labelLayer: HTMLElement | null = null;
let active = false;
let raf = 0;
let dragging = false;
let lastPointer = { x: 0, y: 0 };
let lastZoomVar = '';
let viewRect: { width: number; height: number } | null = null;
let labels: LabelRef[] = [];
let hotIdx: string | null = null;
let framed = false;
let userMoved = false;
const starsByName = new Map<string, ArtistStar>();
const starEls = new Map<string, HTMLElement>();

const cam = { x: 0, y: 0, z: 1 };
const target = { x: 0, y: 0, z: 1 };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashName(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hexToHsl(hex: string): Tone & { l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const raw = m !== null ? m[1] : undefined;
  if (raw === undefined) return null;
  const n = parseInt(raw, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

function toneOf(colors: Iterable<string>): Tone {
  let best: { h: number; s: number; c: number } | null = null;
  for (const hex of colors) {
    const t = hexToHsl(hex);
    if (t === null) continue;
    if (t.l < 0.18 || t.l > 0.85) continue;
    const c = t.s * (1 - Math.abs(t.l - 0.5) * 1.2);
    if (best === null || c > best.c) best = { h: t.h, s: t.s, c };
  }
  if (best === null || best.c < 0.08) return { h: 226, s: 0.6 };
  return { h: best.h, s: Math.min(0.95, Math.max(0.45, best.s)) };
}

function clampPan(): void {
  const halfW = (WORLD_W / 2) * 0.92;
  const halfH = (WORLD_H / 2) * 0.92;
  const camX = -target.x / target.z;
  const camY = -target.y / target.z;
  const cx = Math.max(-halfW, Math.min(halfW, camX));
  const cy = Math.max(-halfH, Math.min(halfH, camY));
  target.x = -cx * target.z;
  target.y = -cy * target.z;
}

function applyTransforms(): void {
  for (const layer of layers) {
    const f = layer.factor;
    const z = 1 + (cam.z - 1) * f;
    layer.el.style.transform = `translate3d(${(cam.x * f).toFixed(2)}px, ${(cam.y * f).toFixed(2)}px, 0) scale(${z.toFixed(4)})`;
  }
  const q = cam.z.toFixed(2);
  if (q !== lastZoomVar && surface !== null) {
    lastZoomVar = q;
    surface.style.setProperty('--uni-zoom', q);
  }
}

function updateLabels(): void {
  if (labelLayer === null || viewRect === null) return;
  const cx = viewRect.width / 2;
  const cy = viewRect.height / 2;
  const z = cam.z;
  const s = Math.min(LABEL_MAX_SCALE, Math.max(1, z));
  const m = 90;
  for (const l of labels) {
    const sx = cx + cam.x + l.wx * z;
    const sy = cy + cam.y + l.wy * z;
    if (sx < -m || sy < -m || sx > viewRect.width + m || sy > viewRect.height + m) {
      if (l.el.style.visibility !== 'hidden') l.el.style.visibility = 'hidden';
      continue;
    }
    if (l.el.style.visibility !== 'visible') l.el.style.visibility = 'visible';
    const tx = sx + (l.d * z) / 2 + 12;
    l.el.style.transform = `translate3d(${tx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translateY(-50%) scale(${s.toFixed(3)})`;
  }
}

function tick(): void {
  cam.x += (target.x - cam.x) * EASE;
  cam.y += (target.y - cam.y) * EASE;
  cam.z += (target.z - cam.z) * EASE;
  applyTransforms();
  updateLabels();
  if (
    Math.abs(target.x - cam.x) < PARK_EPSILON &&
    Math.abs(target.y - cam.y) < PARK_EPSILON &&
    Math.abs(target.z - cam.z) < 0.001
  ) {
    cam.x = target.x;
    cam.y = target.y;
    cam.z = target.z;
    applyTransforms();
    updateLabels();
    raf = 0;
    return;
  }
  raf = window.requestAnimationFrame(tick);
}

function wake(): void {
  if (raf === 0) raf = window.requestAnimationFrame(tick);
}

function zoomAt(localX: number, localY: number, nextZoom: number): void {
  if (viewRect === null) return;
  const cx = viewRect.width / 2;
  const cy = viewRect.height / 2;
  const px = localX - cx;
  const py = localY - cy;
  const wx = (px - cam.x) / cam.z;
  const wy = (py - cam.y) / cam.z;
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nextZoom));
  target.z = z;
  target.x = px - wx * z;
  target.y = py - wy * z;
  clampPan();
  wake();
}

function refreshRect(): void {
  if (surface === null) return;
  const r = surface.getBoundingClientRect();
  viewRect = { width: r.width, height: r.height };
}

function buildSpecks(layer: HTMLElement, spec: LayerSpec): void {
  const rand = mulberry32(SEED + Math.round(spec.factor * 100));
  const frag = document.createDocumentFragment();
  for (let i = 0; i < spec.count; i += 1) {
    const speck = document.createElement('span');
    speck.className = 'uni-speck';
    const bright = i < spec.bright;
    speck.classList.toggle('uni-bright', bright);
    speck.style.left = `${(rand() * 100).toFixed(2)}%`;
    speck.style.top = `${(rand() * 100).toFixed(2)}%`;
    speck.style.setProperty('--s', (bright ? 4.5 + rand() * 2.5 : 1.6 + rand() * 2.4).toFixed(2));
    speck.style.setProperty('--o', (0.24 + rand() * 0.58).toFixed(2));
    const hue = DUST_HUES[Math.floor(rand() * DUST_HUES.length)] ?? 217;
    const h = (hue + (rand() - 0.5) * 16).toFixed(0);
    speck.style.setProperty(
      '--c',
      `hsl(${h} ${Math.round(38 + rand() * 16)}% ${Math.round(68 + rand() * 14)}%)`,
    );
    frag.append(speck);
  }
  layer.append(frag);
}

function setHot(idx: string | null): void {
  if (hotIdx === idx) return;
  if (hotIdx !== null) {
    const prev = labels[Number(hotIdx)];
    if (prev !== undefined) {
      prev.el.classList.remove('hot');
      prev.el.textContent = prev.base;
    }
  }
  hotIdx = idx;
  if (hotIdx !== null) {
    const next = labels[Number(hotIdx)];
    if (next !== undefined) {
      next.el.classList.add('hot');
      if (next.hot !== null) next.el.textContent = next.hot;
    }
  }
}

function setHotFromEvent(e: Event): void {
  const node = (e.target as HTMLElement | null)?.closest?.('.uni-star, .uni-sat, .uni-spark');
  setHot(node instanceof HTMLElement ? (node.dataset.label ?? null) : null);
}

function attachLabel(
  node: HTMLElement,
  wx: number,
  wy: number,
  d: number,
  base: string,
  hot: string | null,
  cls: string,
): void {
  const label = document.createElement('span');
  label.className = cls === '' ? 'uni-star-label' : `uni-star-label ${cls}`;
  label.textContent = base;
  if (labelLayer !== null) labelLayer.append(label);
  node.dataset.label = String(labels.length);
  labels.push({ el: label, wx, wy, d, base, hot });
}

const pinsByArtist = new Map<string, string[]>();

function loadPins(): void {
  void window.mr.storageGet(PINS_KEY).then((raw) => {
    if (raw !== null && typeof raw === 'object') {
      for (const [artist, albums] of Object.entries(raw as Record<string, unknown>)) {
        if (Array.isArray(albums)) {
          pinsByArtist.set(
            artist,
            albums.filter((a): a is string => typeof a === 'string').slice(0, PIN_CAP),
          );
        }
      }
    }
    rebuildSky();
  });
}

function savePins(): void {
  const out: Record<string, string[]> = {};
  for (const [k, v] of pinsByArtist) if (v.length > 0) out[k] = [...v];
  void window.mr.storageSet(PINS_KEY, out);
}

export function isAlbumPinned(artist: string, album: string): boolean {
  return pinsByArtist.get(artist)?.includes(album) ?? false;
}

export function albumPinCount(artist: string): number {
  return pinsByArtist.get(artist)?.length ?? 0;
}

export function toggleAlbumPin(artist: string, album: string): 'pinned' | 'unpinned' | 'full' {
  const list = pinsByArtist.get(artist) ?? [];
  if (list.includes(album)) {
    pinsByArtist.set(artist, list.filter((a) => a !== album));
    savePins();
    rebuildSky();
    return 'unpinned';
  }
  if (list.length >= PIN_CAP) return 'full';
  list.push(album);
  pinsByArtist.set(artist, list);
  savePins();
  rebuildSky();
  return 'pinned';
}

function weightAt(count: number): number {
  return ORBIT_MAX - (Math.log10(Math.max(1, count)) / Math.log10(ABS_WEIGHT_MAX)) * (ORBIT_MAX - ORBIT_MIN);
}

function weightBand(count: number): { lo: number; hi: number } {
  if (count <= 8) return { lo: weightAt(8), hi: ORBIT_MAX };
  if (count <= 40) return { lo: weightAt(40), hi: weightAt(8) };
  if (count <= 300) return { lo: weightAt(300), hi: weightAt(40) };
  return { lo: ORBIT_MIN, hi: ORBIT_MIN };
}

function alphabeticalAngles(names: string[]): Map<string, number> {
  const map = new Map<string, number>();
  const total = names.length;
  if (total === 0) return map;
  let acc = 0;
  let i = 0;
  while (i < total) {
    const letter = names[i]?.charAt(0).toUpperCase() ?? '';
    let j = i;
    while (j < total && (names[j]?.charAt(0).toUpperCase() ?? '') === letter) j += 1;
    const runLen = j - i;
    const span = (runLen / total) * Math.PI * 2;
    for (let k = 0; k < runLen; k += 1) {
      const name = names[i + k];
      if (name === undefined) continue;
      const even = -Math.PI / 2 + acc + ((k + 0.5) / runLen) * span;
      const rand = mulberry32(hashName(name));
      map.set(name, even + (rand() - 0.5) * (span / runLen) * ARC_JITTER);
    }
    acc += span;
    i = j;
  }
  return map;
}

function resolveLayout(nodes: LayoutNode[]): void {
  for (let iter = 0; iter < 42; iter += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        if (b === undefined) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.er + b.er + 74;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        if (d2 === 0) {
          b.x += 1;
          b.y += 1;
          continue;
        }
        const dist = Math.sqrt(d2);
        const push = (min - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
      }
    }
    for (const s of nodes) {
      if (s === undefined) continue;
      const dist = Math.hypot(s.x, s.y);
      const keep = 300 + s.er;
      if (dist < keep) {
        const f = dist === 0 ? 0 : keep / dist;
        s.x = dist === 0 ? keep : s.x * f;
        s.y = dist === 0 ? 0 : s.y * f;
      }
      const bx = WORLD_W / 2 - 60;
      const by = WORLD_H / 2 - 60;
      s.x = Math.max(-bx, Math.min(bx, s.x));
      s.y = Math.max(-by, Math.min(by, s.y));
    }
  }
}

function frameOnce(stars: ArtistStar[]): void {
  framed = true;
  if (userMoved || stars.length === 0 || viewRect === null) return;
  const byRadius = [...stars].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  const total = stars.reduce((n, s) => n + s.count, 0);
  let acc = 0;
  let radius = 0;
  for (const s of byRadius) {
    acc += s.count;
    radius = Math.hypot(s.x, s.y) + s.er;
    if (acc >= total * 0.8) break;
  }
  const z = Math.max(0.75, Math.min(1.5, (Math.min(viewRect.width, viewRect.height) * 0.42) / Math.max(radius, 120)));
  cam.x = 0;
  cam.y = 0;
  cam.z = z;
  target.x = 0;
  target.y = 0;
  target.z = z;
  applyTransforms();
  updateLabels();
}

function applyNow(): void {
  const artist = player.currentTrack !== null ? primaryOf(player.currentTrack) : null;
  for (const [name, el] of starEls) el.classList.toggle('now', name === artist);
}

function rebuildSky(): void {
  if (starsLayer === null || labelLayer === null) return;
  if (satsLayer !== null) satsLayer.textContent = '';
  if (sparksLayer !== null) sparksLayer.textContent = '';
  if (nebLayer !== null) nebLayer.textContent = '';
  if (orbitLayer !== null) orbitLayer.textContent = '';
  starsLayer.textContent = '';
  labelLayer.textContent = '';
  starsByName.clear();
  starEls.clear();
  labels = [];
  setHot(null);
  const result = libraryStore.result;
  const groups = new Map<string, { count: number; colors: Set<string> }>();
  const albumColors = new Map<string, Map<string, Set<string>>>();
  if (result !== null && result.ok) {
    for (const t of result.tracks) {
      const name = primaryOf(t);
      if (name === null || name.trim() === '') continue;
      let g = groups.get(name);
      if (g === undefined) {
        g = { count: 0, colors: new Set<string>() };
        groups.set(name, g);
      }
      g.count += 1;
      if (t.palette !== null) for (const c of t.palette) g.colors.add(c);
      const album = t.album;
      if (album !== null && album.trim() !== '') {
        let albumMap = albumColors.get(name);
        if (albumMap === undefined) {
          albumMap = new Map<string, Set<string>>();
          albumColors.set(name, albumMap);
        }
        let colors = albumMap.get(album);
        if (colors === undefined) {
          colors = new Set<string>();
          albumMap.set(album, colors);
        }
        if (t.palette !== null) for (const c of t.palette) colors.add(c);
      }
    }
  }
  const names = [...groups.keys()].sort((a, b) => {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    return la === lb ? (a < b ? -1 : a > b ? 1 : 0) : la < lb ? -1 : 1;
  });
  const angles = alphabeticalAngles(names);
  const growth = Math.min(GROWTH_CAP, Math.max(1, Math.sqrt(names.length / 12)));
  const stars: ArtistStar[] = [];
  for (const name of names) {
    const g = groups.get(name);
    const count = g !== undefined ? g.count : 1;
    const angle = angles.get(name) ?? 0;
    const band = weightBand(count);
    const rand = mulberry32((hashName(name) ^ 0x9e3779b9) >>> 0);
    const rJittered = weightAt(count) * (1 + (rand() - 0.5) * RADIAL_JITTER);
    const orbit =
      band.hi - band.lo < 24
        ? (band.lo + band.hi) / 2
        : Math.max(band.lo + 10, Math.min(band.hi - 10, rJittered)) * growth;
    stars.push({
      name,
      count,
      x: Math.cos(angle) * orbit,
      y: Math.sin(angle) * orbit * WORLD_SQUASH,
      d: Math.min(64, 20 + Math.sqrt(count) * 4.4),
      tone: toneOf(g !== undefined ? g.colors : []),
      major: false,
      er: 0,
    });
  }

  if (orbitLayer !== null) {
    for (const c of WEIGHT_BANDS) {
      const r = weightAt(c) * growth;
      const ring = document.createElement('span');
      ring.className = 'uni-orbit-line';
      ring.style.width = `${(r * 2).toFixed(1)}px`;
      ring.style.height = `${(r * 2 * WORLD_SQUASH).toFixed(1)}px`;
      orbitLayer.append(ring);
    }
  }

  const byMass = [...stars].sort((a, b) => b.count - a.count);
  for (let i = 0; i < byMass.length && i < MAJOR_CAP; i += 1) {
    const s = byMass[i];
    if (s === undefined || s.count < 2) break;
    s.major = true;
  }

  for (const s of stars) {
    const pins = pinsByArtist.get(s.name) ?? [];
    if (pins.length === 0) {
      s.er = s.d / 2;
      continue;
    }
    const inner = s.d / 2 + 30;
    const outer = s.d / 2 + 56;
    s.er = (pins.length > 4 ? outer : inner) + 10;
  }

  const sparks: SparkData[] = [];
  if (sparksLayer !== null && playlistsStore.ready) {
    for (const pl of playlistsStore.list()) {
      const tracks = playlistsStore.liveTracks(pl.tracks);
      const count = tracks.length;
      const weights = new Map<string, number>();
      for (const t of tracks) {
        const a = primaryOf(t);
        if (a === null) continue;
        weights.set(a, (weights.get(a) ?? 0) + 1);
      }
      let cx = 0;
      let cy = 0;
      let wsum = 0;
      let primary: Tone | null = null;
      let secondary: Tone | null = null;
      let pW = -1;
      let sW = -1;
      for (const [artist, w] of weights) {
        const star = starsByName.get(artist);
        if (star === undefined) continue;
        cx += star.x * w;
        cy += star.y * w;
        wsum += w;
        if (w > pW) {
          secondary = primary;
          sW = pW;
          primary = star.tone;
          pW = w;
        } else if (w > sW) {
          secondary = star.tone;
          sW = w;
        }
      }
      if (primary === null || wsum === 0) {
        const rand = mulberry32(hashName(`pl\u0000${pl.id}`));
        const angle = rand() * Math.PI * 2;
        cx = Math.cos(angle) * 760;
        cy = Math.sin(angle) * 760 * WORLD_SQUASH;
      } else {
        cx /= wsum;
        cy /= wsum;
      }
      const t1 = primary ?? { h: 226, s: 0.55 };
      const t2 = secondary ?? t1;
      const d = count === 0 ? 15 : Math.min(60, 18 + Math.log2(1 + count) * 7);
      sparks.push({ pl, count, d, node: { x: cx, y: cy, er: d / 2 + 8 }, t1, t2 });
    }
  }

  resolveLayout([...stars, ...sparks.map((s) => s.node)]);

  const starFrag = document.createDocumentFragment();
  for (const s of stars) {
    starsByName.set(s.name, s);
    const h = s.tone.h.toFixed(0);
    const sat = Math.round(s.tone.s * 100);
    const star = document.createElement('span');
    star.className = 'uni-star';
    star.dataset.name = s.name;
    star.style.left = `${(s.x + WORLD_W / 2).toFixed(1)}px`;
    star.style.top = `${(s.y + WORLD_H / 2).toFixed(1)}px`;
    star.style.setProperty('--d', s.d.toFixed(1));
    star.style.setProperty('--hot', `hsl(${h} ${Math.round(sat * 0.45)}% 97%)`);
    star.style.setProperty('--body', `hsl(${h} ${sat}% 64%)`);
    star.style.setProperty('--rim', `hsl(${h} ${Math.min(100, sat + 12)}% 78%)`);
    starFrag.append(star);
    starEls.set(s.name, star);
    attachLabel(star, s.x, s.y, s.d, s.name, null, s.major ? 'major' : '');
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      appBus.emit('universe-open-artist', { name: s.name });
    });
  }
  starsLayer.append(starFrag);

  if (satsLayer !== null) {
    const satFrag = document.createDocumentFragment();
    for (const s of stars) {
      const pins = pinsByArtist.get(s.name) ?? [];
      if (pins.length === 0) continue;
      const albumTones = albumColors.get(s.name);
      const inner = s.d / 2 + 30;
      const outer = s.d / 2 + 56;
      const ringCount = pins.length > 4 ? 2 : 1;
      const h = s.tone.h.toFixed(0);
      for (let r = 0; r < ringCount; r += 1) {
        const radius = r === 0 ? inner : outer;
        const ring = document.createElement('span');
        ring.className = 'uni-ring';
        ring.style.width = `${(radius * 2).toFixed(1)}px`;
        ring.style.height = `${(radius * 2).toFixed(1)}px`;
        ring.style.left = `${(s.x + WORLD_W / 2).toFixed(1)}px`;
        ring.style.top = `${(s.y + WORLD_H / 2).toFixed(1)}px`;
        ring.style.borderColor = `hsl(${h} 45% 74% / 0.16)`;
        satFrag.append(ring);
      }
      for (let i = 0; i < pins.length && i < PIN_CAP; i += 1) {
        const album = pins[i];
        if (album === undefined) continue;
        const colors = albumTones?.get(album);
        const tone = colors !== undefined ? toneOf(colors) : s.tone;
        const radius = i < 4 ? inner : outer;
        const rand = mulberry32(hashName(`${s.name}\u0000${album}`));
        const angle = rand() * Math.PI * 2;
        const nx = s.x + Math.cos(angle) * radius;
        const ny = s.y + Math.sin(angle) * radius;
        const node = document.createElement('span');
        node.className = 'uni-sat';
        node.dataset.name = album;
        node.style.left = `${(nx + WORLD_W / 2).toFixed(1)}px`;
        node.style.top = `${(ny + WORLD_H / 2).toFixed(1)}px`;
        node.style.setProperty('--hot', `hsl(${tone.h.toFixed(0)} 50% 96%)`);
        node.style.setProperty('--body', `hsl(${tone.h.toFixed(0)} ${Math.round(tone.s * 100)}% 64%)`);
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          appBus.emit('universe-open-album', { artist: s.name, album });
        });
        satFrag.append(node);
        attachLabel(node, nx, ny, 10, album, null, 'sat');
      }
    }
    satsLayer.append(satFrag);
  }

  if (sparksLayer !== null) {
    const sparkFrag = document.createDocumentFragment();
    for (const sp of sparks) {
      const spark = document.createElement('span');
      spark.className = sp.count === 0 ? 'uni-spark ghost' : 'uni-spark';
      spark.style.left = `${(sp.node.x + WORLD_W / 2).toFixed(1)}px`;
      spark.style.top = `${(sp.node.y + WORLD_H / 2).toFixed(1)}px`;
      spark.style.setProperty('--d', sp.d.toFixed(1));
      spark.style.setProperty('--a', `hsl(${sp.t1.h.toFixed(0)} ${Math.round(Math.max(0.5, sp.t1.s) * 100)}% 70%)`);
      spark.style.setProperty('--b', `hsl(${sp.t2.h.toFixed(0)} ${Math.round(Math.max(0.5, sp.t2.s) * 100)}% 62%)`);
      spark.addEventListener('click', (e) => {
        e.stopPropagation();
        appBus.emit('universe-open-playlist', { id: sp.pl.id });
      });
      sparkFrag.append(spark);
      attachLabel(
        spark,
        sp.node.x,
        sp.node.y,
        sp.d,
        sp.pl.name,
        `${sp.pl.name} · ${sp.count} song${sp.count === 1 ? '' : 's'}`,
        '',
      );
    }
    sparksLayer.append(sparkFrag);
  }

  if (nebLayer !== null) {
    const nebFrag = document.createDocumentFragment();
    for (const s of byMass.slice(0, NEBULA_CAP)) {
      if (s === undefined || s.count < 2) break;
      const neb = document.createElement('span');
      neb.className = 'uni-nebula';
      const size = Math.min(1500, 800 + s.count * 10).toFixed(0);
      neb.style.width = `${size}px`;
      neb.style.height = `${size}px`;
      neb.style.left = `${(s.x + WORLD_W / 2).toFixed(1)}px`;
      neb.style.top = `${(s.y + WORLD_H / 2).toFixed(1)}px`;
      neb.style.background = `radial-gradient(circle, hsl(${s.tone.h.toFixed(0)} ${Math.round(
        s.tone.s * 80,
      )}% 58% / 0.05) 0%, transparent 68%)`;
      nebFrag.append(neb);
    }
    nebLayer.append(nebFrag);
  }

  applyTransforms();
  updateLabels();
  applyNow();
  frameOnce(stars);
}

function buildSurface(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'universe';
  section.setAttribute('aria-label', 'Universe view');
  section.hidden = true;

  const field = document.createElement('div');
  field.className = 'uni-field';
  section.append(field);

  const neb = document.createElement('div');
  neb.className = 'uni-layer uni-neb';
  section.append(neb);
  layers.push({ el: neb, factor: 0.55 });
  nebLayer = neb;

  for (const spec of LAYERS) {
    const layer = document.createElement('div');
    layer.className = `uni-layer ${spec.cls}`;
    buildSpecks(layer, spec);
    section.append(layer);
    layers.push({ el: layer, factor: spec.factor });
  }

  const orbits = document.createElement('div');
  orbits.className = 'uni-layer uni-orbits';
  section.append(orbits);
  layers.push({ el: orbits, factor: 1 });
  orbitLayer = orbits;

  const stars = document.createElement('div');
  stars.className = 'uni-layer uni-stars';
  section.append(stars);
  layers.push({ el: stars, factor: 1 });
  starsLayer = stars;

  const sats = document.createElement('div');
  sats.className = 'uni-layer uni-sats';
  section.append(sats);
  layers.push({ el: sats, factor: 1 });
  satsLayer = sats;

  const sparks = document.createElement('div');
  sparks.className = 'uni-layer uni-sparks';
  section.append(sparks);
  layers.push({ el: sparks, factor: 1 });
  sparksLayer = sparks;

  const labelPlane = document.createElement('div');
  labelPlane.className = 'uni-labels';
  section.append(labelPlane);
  labelLayer = labelPlane;

  section.addEventListener('wheel', (e) => {
    e.preventDefault();
    userMoved = true;
    const rect = section.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, cam.z * Math.exp(-e.deltaY * ZOOM_WHEEL));
  }, { passive: false });

  section.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest?.('.uni-star, .uni-sat, .uni-spark') !== null) return;
    userMoved = true;
    dragging = true;
    lastPointer = { x: e.clientX, y: e.clientY };
    section.setPointerCapture(e.pointerId);
  });
  section.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    target.x += e.clientX - lastPointer.x;
    target.y += e.clientY - lastPointer.y;
    lastPointer = { x: e.clientX, y: e.clientY };
    clampPan();
    wake();
  });
  const release = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (section.hasPointerCapture(e.pointerId)) section.releasePointerCapture(e.pointerId);
  };
  section.addEventListener('pointerup', release);
  section.addEventListener('pointercancel', release);
  section.addEventListener('pointerover', setHotFromEvent);
  section.addEventListener('pointerout', (e) => {
    if ((e.target as HTMLElement | null)?.closest?.('.uni-star, .uni-sat, .uni-spark') !== null) {
      setHot(null);
    }
  });

  return section;
}

export function initUniverse(): void {
  if (surface !== null) return;
  surface = buildSurface();
  document.body.append(surface);
  refreshRect();
  applyTransforms();
  window.addEventListener('resize', () => {
    refreshRect();
    updateLabels();
  });
  appBus.on('track-selected', applyNow);
  libraryStore.onChange(rebuildSky);
  playlistsStore.onChange(() => rebuildSky());
  void playlistsStore.load();
  loadPins();
  rebuildSky();
}

export function setUniverseVisible(on: boolean): void {
  if (surface === null || active === on) return;
  active = on;
  surface.hidden = !on;
  surface.classList.toggle('on', on);
  document.body.classList.toggle('universe-active', on);
  if (on) {
    refreshRect();
    updateLabels();
    wake();
  } else if (raf !== 0) {
    window.cancelAnimationFrame(raf);
    raf = 0;
  }
}
