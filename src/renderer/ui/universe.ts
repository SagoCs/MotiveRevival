import '../styles/universe.css';
import { libraryStore } from '../core/libraryStore';
import { playlistsStore } from '../core/playlistsStore';
import { player } from '../core/player';
import { appBus } from '../core/appBus';
import { primaryOf } from '../core/searchIndex';
import { onMoment } from '../core/moments';
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
const WORLD_SQUASH = 0.5;
const OVAL_TILT = 0.12;
const ANGLE_NOISE = 0.3;
const SCATTER = 0.8;
const GROWTH_CAP = 1.6;
const ARC_JITTER = 0.7;
const LABEL_MAX_SCALE = 1.5;
const MAJOR_CAP = 8;
const HOLE_D = 170;
const HALO_MIN = 340;
const HALO_MAX = 560;
const COURT_KEEP = 640;
const HALO_W = 1800;
const HALO_H = 1100;
const SWIRL_BMP = 1120;
const SWIRL_PX = 560;
const NEB_W = 1080;
const NEB_H = 660;
const POOL_W = 900;
const POOL_H = 550;
const NEBULAE = false;
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Tone {
  h: number;
  s: number;
}

interface Layer {
  el: HTMLElement;
  factor: number;
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
  center: boolean;
}

interface LayoutNode {
  x: number;
  y: number;
  er: number;
}

interface SparkSource {
  name: string;
  w: number;
}

interface SparkData {
  pl: Playlist;
  count: number;
  d: number;
  node: LayoutNode;
  t1: Tone;
  t2: Tone;
  sources: SparkSource[];
}

interface FieldSpec {
  count: number;
  minSize: number;
  maxSize: number;
  minAlpha: number;
  maxAlpha: number;
  twinkles: number;
  seed: number;
}

let surface: HTMLElement | null = null;
let layers: Layer[] = [];
let starsLayer: HTMLElement | null = null;
let sparksLayer: HTMLElement | null = null;
let heartLayer: HTMLElement | null = null;
let deepPlane: HTMLElement | null = null;
let nearPlane: HTMLElement | null = null;
let labelLayer: HTMLElement | null = null;
let threadSvg: SVGSVGElement | null = null;
let holeEl: HTMLElement | null = null;
let haloCtx: CanvasRenderingContext2D | null = null;
let swirlCtx: CanvasRenderingContext2D | null = null;
let nebCtx: CanvasRenderingContext2D | null = null;
let nebMask: HTMLCanvasElement | null = null;
let poolsCtx: CanvasRenderingContext2D | null = null;
let active = false;
let raf = 0;
let dragging = false;
let lastPointer = { x: 0, y: 0 };
let lastZoomVar = '';
let viewRect: { width: number; height: number } | null = null;
let labels: LabelRef[] = [];
let hotIdx: string | null = null;
let threadsFor: HTMLElement | null = null;
let userMoved = false;
let painted = false;
let lastHue = -99;
let chaseRaf = 0;
let rasterZ = 1;
let settleTimer = 0;
let lastPulse = 0;
const starsByName = new Map<string, ArtistStar>();
const starEls = new Map<string, HTMLElement>();
const sparksByEl = new Map<HTMLElement, SparkData>();

const cam = { x: 0, y: 0, z: 1 };
const target = { x: 0, y: 0, z: 1 };
let lastStars: ArtistStar[] = [];

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

function rgbToHue(r: number, g: number, b: number): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return (h + 360) % 360;
}

function oklchHue(l: number, c: number, hDeg: number): number {
  const hr = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const lp = l + 0.3963377774 * a + 0.2158037573 * b;
  const mp = l - 0.1055613458 * a - 0.0638541728 * b;
  const sp = l - 0.0894841775 * a - 1.291485548 * b;
  const lw = lp * lp * lp;
  const mw = mp * mp * mp;
  const sw = sp * sp * sp;
  const r = 4.0767416621 * lw - 3.3077115913 * mw + 0.2309699292 * sw;
  const g = -1.2684380046 * lw + 2.6097574011 * mw - 0.3413193965 * sw;
  const bl = -0.0041960863 * lw - 0.7034186147 * mw + 1.707614701 * sw;
  const gamma = (v: number): number => {
    const x = Math.max(0, Math.min(1, v));
    return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  };
  return rgbToHue(gamma(r) * 255, gamma(g) * 255, gamma(bl) * 255);
}

function parseHue(value: string): number | null {
  const hslM = /hsl\(\s*([\d.eE+-]+)[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/.exec(value);
  if (hslM !== null && hslM[1] !== undefined) return ((parseFloat(hslM[1]) % 360) + 360) % 360;
  const rgbC = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(value);
  if (rgbC !== null && rgbC[1] !== undefined && rgbC[2] !== undefined && rgbC[3] !== undefined) {
    return rgbToHue(parseFloat(rgbC[1]), parseFloat(rgbC[2]), parseFloat(rgbC[3]));
  }
  const rgbS = /rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
  if (rgbS !== null && rgbS[1] !== undefined && rgbS[2] !== undefined && rgbS[3] !== undefined) {
    return rgbToHue(parseFloat(rgbS[1]), parseFloat(rgbS[2]), parseFloat(rgbS[3]));
  }
  const ok = /oklch\(\s*([\d.]+)%?\s+([\d.]+)%?\s+([\d.]+)/.exec(value);
  if (ok !== null && ok[1] !== undefined && ok[2] !== undefined && ok[3] !== undefined) {
    const l = parseFloat(ok[1]);
    const c = parseFloat(ok[2]);
    return oklchHue(l > 1 ? l / 100 : l, c > 1 ? c / 100 : c, parseFloat(ok[3]));
  }
  return null;
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
    if (l.center) {
      l.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${s.toFixed(3)})`;
    } else {
      const tx = sx + (l.d * z) / 2 + 12;
      l.el.style.transform = `translate3d(${tx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translateY(-50%) scale(${s.toFixed(3)})`;
    }
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
    parkRaster();
    raf = 0;
    return;
  }
  raf = window.requestAnimationFrame(tick);
}

function wake(): void {
  liftRaster();
  if (raf === 0) raf = window.requestAnimationFrame(tick);
}

function parkRaster(): void {
  if (settleTimer !== 0) return;
  settleTimer = window.setTimeout(() => {
    settleTimer = 0;
    if (Math.abs(cam.z - rasterZ) / rasterZ < 0.05) return;
    rasterZ = cam.z;
    for (const el of [starsLayer, sparksLayer, heartLayer, deepPlane, nearPlane]) {
      if (el !== null) el.style.willChange = 'auto';
    }
  }, 140);
}

function liftRaster(): void {
  if (settleTimer !== 0) {
    window.clearTimeout(settleTimer);
    settleTimer = 0;
  }
  for (const el of [starsLayer, sparksLayer, heartLayer, deepPlane, nearPlane]) {
    if (el !== null && el.style.willChange !== '') el.style.willChange = '';
  }
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

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

function buildFieldStars(layer: HTMLElement, spec: FieldSpec): void {
  const rand = mulberry32(spec.seed);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < spec.count; i += 1) {
    const wx0 = (rand() * 2 - 1) * (WORLD_W / 2);
    const wy0 = (rand() * 2 - 1) * (WORLD_H / 2);
    const dist = Math.hypot(wx0, wy0);
    if (dist < 200) continue;
    let wx = wx0;
    let wy = wy0;
    if (dist < 450) {
      const pull = Math.pow(1 - dist / 450, 2);
      const ang = Math.atan2(wy, wx) + pull * 0.35;
      const nd = dist * (1 - 0.45 * pull);
      wx = Math.cos(ang) * nd;
      wy = Math.sin(ang) * nd;
    }
    const star = document.createElement('span');
    star.className = 'uni-fstar';
    if (i < spec.twinkles) star.classList.add('twink');
    star.style.left = `${(((wx + WORLD_W / 2) / WORLD_W) * 100).toFixed(2)}%`;
    star.style.top = `${(((wy + WORLD_H / 2) / WORLD_H) * 100).toFixed(2)}%`;
    const hue = rand() < 0.5 ? 42 : 216;
    star.style.setProperty('--c', `hsl(${hue} ${Math.round(6 + rand() * 8)}% ${Math.round(90 + rand() * 7)}%)`);
    const t = Math.pow(rand(), 2.2);
    const size = spec.minSize + (spec.maxSize - spec.minSize) * t;
    star.style.width = `${(size * 2.2).toFixed(2)}px`;
    star.style.height = `${(size * 2.2).toFixed(2)}px`;
    star.style.opacity = (spec.minAlpha + (spec.maxAlpha - spec.minAlpha) * t).toFixed(2);
    if (i < spec.twinkles) {
      star.style.setProperty('--tdur', `${(3 + rand() * 4).toFixed(2)}s`);
      star.style.setProperty('--tdel', `${(-rand() * 6).toFixed(2)}s`);
    }
    frag.append(star);
  }
  layer.append(frag);
}

function makeNoise(seed: number, gw: number, gh: number): (x: number, y: number) => number {
  const g = new Float32Array((gw + 1) * (gh + 1));
  const rand = mulberry32(seed);
  for (let i = 0; i < g.length; i += 1) g[i] = rand();
  const at = (ix: number, iy: number): number => {
    const cx = ix < 0 ? 0 : ix > gw ? gw : ix;
    const cy = iy < 0 ? 0 : iy > gh ? gh : iy;
    return g[cy * (gw + 1) + cx] ?? 0;
  };
  return (x, y) => {
    const gx = Math.max(0, Math.min(gw, x * gw));
    const gy = Math.max(0, Math.min(gh, y * gh));
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy) * (1 - ux) + at(ix + 1, iy) * ux;
    const b = at(ix, iy + 1) * (1 - ux) + at(ix + 1, iy + 1) * ux;
    return a * (1 - uy) + b * uy;
  };
}

function fbmOf(noise: (x: number, y: number) => number): (x: number, y: number) => number {
  return (x, y) =>
    (noise(x, y) * 4 + noise(x * 2.03 + 7.3, y * 2.01 + 1.9) * 2 + noise(x * 4.01 + 3.1, y * 3.97 + 8.4)) / 7;
}

function buildNebulaMask(): HTMLCanvasElement {
  const mask = makeCanvas(NEB_W, NEB_H);
  const ctx = mask.getContext('2d');
  if (ctx === null) return mask;
  const rw = 540;
  const rh = 330;
  const warpX = fbmOf(makeNoise(SEED ^ 0x1f2e3d, 8, 8));
  const warpY = fbmOf(makeNoise(SEED ^ 0x2e3d4c, 8, 8));
  const value = fbmOf(makeNoise(SEED ^ 0x3d4c5b, 6, 6));
  const lane = fbmOf(makeNoise(SEED ^ 0x4c5b6a, 7, 7));
  const rand = mulberry32(SEED ^ 0x5b6a79);
  const regions: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < 4; i += 1) {
    const ang = rand() * Math.PI * 2;
    const dist = 480 + rand() * 620;
    regions.push({
      x: WORLD_W / 2 + Math.cos(ang) * dist,
      y: WORLD_H / 2 + Math.sin(ang) * dist * 0.9,
      r: 380 + rand() * 260,
    });
  }
  const sx = rw / WORLD_W;
  const sy = rh / WORLD_H;
  const img = ctx.createImageData(rw, rh);
  const grain = mulberry32(SEED ^ 0x6a7b88);
  for (let py = 0; py < rh; py += 1) {
    for (let px = 0; px < rw; px += 1) {
      const wx = px / rw;
      const wy = py / rh;
      const ax = wx + (warpX(wx + 4.1, wy + 2.7) - 0.5) * 0.55;
      const ay = wy + (warpY(wx + 1.3, wy + 5.2) - 0.5) * 0.55;
      const v = value(ax, ay);
      const worldX = px / sx;
      const worldY = py / sy;
      let fall = 0;
      for (const rg of regions) {
        const d = Math.hypot(worldX - rg.x, worldY - rg.y) / rg.r;
        if (d < 1) fall = Math.max(fall, 1 - d * d);
      }
      const cdx = worldX - WORLD_W / 2;
      const cdy = worldY - WORLD_H / 2;
      const along = cdx * 0.868 - cdy * 0.497;
      const perp = cdx * 0.497 + cdy * 0.868;
      const cl =
        Math.exp(-(perp * perp) / 204800) * Math.exp(-(along * along) / 5120000);
      let a = Math.max(0, (v - 0.4) * 2.1) * fall;
      const lv = lane(wx * 1.7 + 3.3, wy * 1.7 + 6.6);
      a *= 1 - 0.72 * Math.exp(-((lv - 0.5) * (lv - 0.5)) / 0.005) * fall;
      a += cl * Math.max(0, v - 0.35) * 0.5;
      a = Math.min(1, a);
      const lum = 150 + v * 105 + (grain() - 0.5) * 9;
      const idx = (py * rw + px) * 4;
      img.data[idx] = lum;
      img.data[idx + 1] = lum;
      img.data[idx + 2] = lum;
      img.data[idx + 3] = Math.round(a * 255);
    }
  }
  const buf = makeCanvas(rw, rh);
  const bctx = buf.getContext('2d');
  if (bctx === null) return mask;
  bctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(buf, 0, 0, NEB_W, NEB_H);
  return mask;
}

function tintNebula(hue: number): void {
  if (nebCtx === null || nebMask === null) return;
  nebCtx.globalCompositeOperation = 'copy';
  nebCtx.drawImage(nebMask, 0, 0);
  nebCtx.globalCompositeOperation = 'multiply';
  nebCtx.fillStyle = `hsl(${hue.toFixed(0)} 48% 58%)`;
  nebCtx.fillRect(0, 0, NEB_W, NEB_H);
  nebCtx.globalCompositeOperation = 'destination-in';
  nebCtx.drawImage(nebMask, 0, 0);
  nebCtx.globalCompositeOperation = 'source-over';
}

function chaseAccent(): void {
  if (chaseRaf !== 0) return;
  const start = performance.now();
  const step = (): void => {
    chaseRaf = 0;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--acc-a').trim();
    const hue = parseHue(raw);
    if (hue !== null && Math.abs(hue - lastHue) > 0.8) {
      lastHue = hue;
      tintNebula(hue);
    }
    if (performance.now() - start < 820) {
      chaseRaf = window.requestAnimationFrame(step);
    }
  };
  chaseRaf = window.requestAnimationFrame(step);
}

function paintSwirl(): void {
  const ctx = swirlCtx;
  if (ctx === null) return;
  const scale = SWIRL_BMP / SWIRL_PX;
  const c = SWIRL_BMP / 2;
  const r0 = (HOLE_D / 2 + 3) * scale;
  const R = 145 * scale;
  const rand = mulberry32(SEED ^ 0x51ade);
  const bright = -0.35;
  const drawSpirals = (target: CanvasRenderingContext2D, count: number, wMin: number, wMax: number, aMin: number, aMax: number): void => {
    for (let i = 0; i < count; i += 1) {
      const t = Math.pow(rand(), 1.2);
      const rr = r0 + t * (R - r0);
      const a = rand() * Math.PI * 2;
      const sweep = (0.12 + rand() * 0.38) * (1 - t * 0.4);
      const grow = Math.min((10 + rand() * 35) * scale, R - rr);
      const width = (wMin + rand() * (wMax - wMin)) * scale;
      const asym = Math.max(0.12, 1 + 0.85 * Math.cos(a - bright));
      const fade = Math.pow(1 - t, 1.15);
      const alpha = (aMin + rand() * (aMax - aMin)) * fade * asym;
      target.strokeStyle = `rgba(236, 239, 246, ${alpha.toFixed(3)})`;
      target.lineWidth = width;
      target.beginPath();
      const segs = 7;
      for (let k = 0; k <= segs; k += 1) {
        const u = k / segs;
        const ang = a + u * sweep;
        const rad = rr + u * grow;
        const px = c + Math.cos(ang) * rad;
        const py = c + Math.sin(ang) * rad;
        if (k === 0) target.moveTo(px, py);
        else target.lineTo(px, py);
      }
      target.stroke();
    }
  };
  ctx.clearRect(0, 0, SWIRL_BMP, SWIRL_BMP);
  ctx.globalCompositeOperation = 'lighter';
  const envStart = 70 * scale;
  const env = ctx.createRadialGradient(c, c, envStart, c, c, R);
  env.addColorStop(0, 'rgba(238, 241, 247, 0.1)');
  env.addColorStop(0.14, 'rgba(238, 241, 247, 0.075)');
  env.addColorStop(0.45, 'rgba(238, 241, 247, 0.032)');
  env.addColorStop(1, 'rgba(238, 241, 247, 0)');
  ctx.fillStyle = env;
  ctx.fillRect(0, 0, SWIRL_BMP, SWIRL_BMP);
  const haze = makeCanvas(SWIRL_BMP, SWIRL_BMP);
  const hazeCtx = haze.getContext('2d');
  if (hazeCtx !== null) {
    hazeCtx.globalCompositeOperation = 'lighter';
    drawSpirals(hazeCtx, 26, 3, 8, 0.012, 0.04);
  }
  ctx.filter = `blur(${(4 * scale).toFixed(1)}px)`;
  ctx.drawImage(haze, 0, 0);
  const fils = makeCanvas(SWIRL_BMP, SWIRL_BMP);
  const filsCtx = fils.getContext('2d');
  if (filsCtx !== null) {
    filsCtx.globalCompositeOperation = 'lighter';
    drawSpirals(filsCtx, 680, 0.5, 2, 0.02, 0.15);
  }
  ctx.filter = `blur(${(1.5 * scale).toFixed(1)}px)`;
  ctx.drawImage(fils, 0, 0);
  ctx.filter = 'none';
  drawSpirals(ctx, 26, 0.5, 1.2, 0.04, 0.11);
  ctx.globalCompositeOperation = 'source-over';
}

function paintSky(): void {
  if (!NEBULAE) return;
  nebMask = buildNebulaMask();
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--acc-a').trim();
  const hue = parseHue(raw);
  lastHue = hue ?? 226;
  tintNebula(lastHue);
}

function paintSparkGlow(ctx: CanvasRenderingContext2D, sx: number, sp: SparkData): void {
  const x = (sp.node.x + WORLD_W / 2) * sx;
  const y = (sp.node.y + WORLD_H / 2) * sx;
  const core = Math.max(4, sp.d * 0.5 * sx);
  const h = sp.t1.h.toFixed(0);
  const sat = Math.round(Math.max(60, sp.t1.s * 100));
  const coreG = ctx.createRadialGradient(x, y, 0, x, y, core * 1.6);
  coreG.addColorStop(0, `hsla(${h}, ${sat}%, 68%, 0.5)`);
  coreG.addColorStop(0.5, `hsla(${h}, ${sat}%, 62%, 0.2)`);
  coreG.addColorStop(1, `hsla(${h}, ${sat}%, 55%, 0)`);
  ctx.fillStyle = coreG;
  ctx.fillRect(x - core * 1.6, y - core * 1.6, core * 3.2, core * 3.2);
  const reach = sp.d * 1.9 * sx;
  const w = Math.max(2, sp.d * 0.16 * sx);
  const tiers: Array<{ scale: number; wide: number; alpha: number[] }> = [
    { scale: 0.62, wide: 2, alpha: [0.3, 0.12, 0] },
    { scale: 0.36, wide: 3, alpha: [0.13, 0, 0] },
  ];
  for (let i = 0; i < 4; i += 1) {
    const ang = (i * Math.PI) / 2;
    for (const tier of tiers) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.scale(reach * tier.scale, w * tier.wide);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `hsla(${h}, ${sat}%, 66%, ${tier.alpha[0]})`);
      g.addColorStop(0.4, `hsla(${h}, ${sat}%, 60%, ${tier.alpha[1]})`);
      g.addColorStop(0.75, `hsla(${h}, ${sat}%, 56%, ${tier.alpha[2]})`);
      g.addColorStop(1, `hsla(${h}, ${sat}%, 55%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function paintStar(ctx: CanvasRenderingContext2D, sx: number, s: ArtistStar): void {
  const x = (s.x + WORLD_W / 2) * sx;
  const y = (s.y + WORLD_H / 2) * sx;
  const reach = (s.major ? 0.75 : 0.55) + randStop(s.name, 7) * 0.2;
  const inten = 0.85 + randStop(s.name, 8) * 0.3;
  const r = Math.max(5, s.d * 0.5 * (1 + reach) * sx);
  const h = s.tone.h;
  const drift = (randStop(s.name, 16) - 0.5) * 24;
  const sat = Math.min(92, Math.max(50, s.tone.s * 100));
  const bloomSat = Math.min(95, Math.max(85, sat + 10));
  const stretch = 0.1 + randStop(s.name, 2) * 0.15;
  const stretchAng = randStop(s.name, 3) * Math.PI;
  const hlAng = randStop(s.name, 9) * Math.PI * 2;
  const hlPow = 0.1 + randStop(s.name, 10) * 0.16 + (s.major ? 0.05 : 0);
  const h0 = h.toFixed(0);
  const h1 = ((h + drift * 0.5 + 360) % 360).toFixed(0);
  const h2 = ((h + drift + 360) % 360).toFixed(0);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(stretchAng);
  ctx.scale(r * (1 + stretch), r * (1 - stretch * 0.7));
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, `hsla(${h0}, ${Math.round(sat * 0.3)}%, 98%, ${inten.toFixed(3)})`);
  g.addColorStop(0.2, `hsla(${h0}, ${Math.round(bloomSat * 0.85)}%, 80%, ${(0.75 * inten).toFixed(3)})`);
  g.addColorStop(0.46, `hsla(${h0}, ${bloomSat}%, 64%, ${(0.62 * inten).toFixed(3)})`);
  g.addColorStop(0.7, `hsla(${h1}, ${Math.round(bloomSat * 0.92)}%, 58%, ${(0.34 * inten).toFixed(3)})`);
  g.addColorStop(0.9, `hsla(${h1}, ${Math.round(bloomSat * 0.7)}%, 78%, ${(0.6 * inten).toFixed(3)})`);
  g.addColorStop(0.97, `hsla(${h2}, ${Math.round(sat * 0.8)}%, 60%, ${(0.12 * inten).toFixed(3)})`);
  g.addColorStop(1, `hsla(${h2}, ${Math.round(sat)}%, 50%, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  const hx = Math.cos(hlAng) * 0.18;
  const hy = Math.sin(hlAng) * 0.18;
  const hl = ctx.createRadialGradient(hx, hy, 0, hx, hy, 0.32);
  hl.addColorStop(0, `hsla(${h0}, 24%, 99%, ${hlPow.toFixed(3)})`);
  hl.addColorStop(1, `hsla(${h0}, 24%, 99%, 0)`);
  ctx.fillStyle = hl;
  ctx.beginPath();
  ctx.arc(hx, hy, 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintHalos(stars: ArtistStar[], sparks: SparkData[]): void {
  const ctx = haloCtx;
  if (ctx === null) return;
  ctx.clearRect(0, 0, HALO_W, HALO_H);
  const sx = HALO_W / WORLD_W;
  for (const s of stars) paintStar(ctx, sx, s);
  for (const sp of sparks) paintSparkGlow(ctx, sx, sp);
}

function paintPools(stars: ArtistStar[]): void {
  const ctx = poolsCtx;
  if (ctx === null) return;
  ctx.clearRect(0, 0, POOL_W, POOL_H);
  const sx = POOL_W / WORLD_W;
  const sy = POOL_H / WORLD_H;
  for (const s of stars) {
    if (!s.major) continue;
    const x = (s.x + WORLD_W / 2) * sx;
    const y = (s.y + WORLD_H / 2) * sy;
    const r = Math.max(14, s.d * 3.4 * sx);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `hsla(${s.tone.h.toFixed(0)}, ${Math.round(s.tone.s * 70)}%, 60%, 0.08)`);
    grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
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

function showThreads(el: HTMLElement): void {
  if (threadsFor === el) return;
  const sp = sparksByEl.get(el);
  if (threadSvg === null || sp === undefined || surface === null) return;
  clearThreads();
  threadsFor = el;
  let rank = 0;
  for (const src of sp.sources) {
    if (rank >= 3) break;
    const star = starsByName.get(src.name);
    if (star === undefined) continue;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', (sp.node.x + WORLD_W / 2).toFixed(1));
    line.setAttribute('y1', (sp.node.y + WORLD_H / 2).toFixed(1));
    line.setAttribute('x2', (star.x + WORLD_W / 2).toFixed(1));
    line.setAttribute('y2', (star.y + WORLD_H / 2).toFixed(1));
    line.setAttribute('class', rank === 0 ? 'thread primary' : 'thread');
    threadSvg.append(line);
    const sel = starEls.get(src.name);
    if (sel !== undefined) sel.classList.add('lit');
    rank += 1;
  }
  if (rank > 0) {
    threadSvg.classList.add('on');
    surface.classList.add('constellating');
  }
}

function clearThreads(): void {
  threadsFor = null;
  if (threadSvg !== null) {
    threadSvg.classList.remove('on');
    threadSvg.textContent = '';
  }
  if (surface !== null) surface.classList.remove('constellating');
  for (const el of starEls.values()) el.classList.remove('lit');
}

function attachLabel(
  node: HTMLElement,
  wx: number,
  wy: number,
  d: number,
  base: string,
  hot: string | null,
  cls: string,
  center = false,
): void {
  const label = document.createElement('span');
  label.className = cls === '' ? 'uni-star-label' : `uni-star-label ${cls}`;
  label.textContent = base;
  if (labelLayer !== null) labelLayer.append(label);
  node.dataset.label = String(labels.length);
  labels.push({ el: label, wx, wy, d, base, hot, center });
}

function weightAt(count: number): number {
  return ORBIT_MAX - (Math.log10(Math.max(1, count)) / Math.log10(ABS_WEIGHT_MAX)) * (ORBIT_MAX - ORBIT_MIN);
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

function resolveLayout(nodes: LayoutNode[], keepBase: number): void {
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
      const keep = keepBase + s.er;
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
  chaseAccent();
}

function rebuildSky(): void {
  if (starsLayer === null || labelLayer === null) return;
  if (sparksLayer !== null) sparksLayer.textContent = '';
  if (threadSvg !== null) {
    threadSvg.classList.remove('on');
    threadSvg.textContent = '';
  }
  if (surface !== null) surface.classList.remove('constellating');
  threadsFor = null;
  starsLayer.textContent = '';
  labelLayer.textContent = '';
  starsByName.clear();
  starEls.clear();
  sparksByEl.clear();
  labels = [];
  setHot(null);
  const result = libraryStore.result;
  const groups = new Map<string, { count: number; colors: Set<string> }>();
  let totalSongs = 0;
  if (result !== null && result.ok) {
    totalSongs = result.tracks.length;
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
    }
  }
  const names = [...groups.keys()].sort((a, b) => {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    return la === lb ? (a < b ? -1 : a > b ? 1 : 0) : la < lb ? -1 : 1;
  });
  const angles = alphabeticalAngles(names);
  const growth = Math.min(GROWTH_CAP, Math.max(1, Math.sqrt(names.length / 12)));
  const tiltC = Math.cos(OVAL_TILT);
  const tiltS = Math.sin(OVAL_TILT);
  const stars: ArtistStar[] = [];
  for (const name of names) {
    const g = groups.get(name);
    const count = g !== undefined ? g.count : 1;
    const rand = mulberry32((hashName(name) ^ 0x9e3779b9) >>> 0);
    const angle = (angles.get(name) ?? 0) + (rand() - 0.5) * 2 * ANGLE_NOISE;
    const orbit = weightAt(count) * growth * (1 + (rand() - 0.5) * SCATTER);
    const lobed =
      orbit * (1 + 0.16 * Math.sin(2 * angle + 1.3) + 0.11 * Math.sin(3 * angle + 4.1));
    const ex = Math.cos(angle) * lobed;
    const ey = Math.sin(angle) * lobed * WORLD_SQUASH;
    stars.push({
      name,
      count,
      x: ex * tiltC - ey * tiltS,
      y: ex * tiltS + ey * tiltC,
      d: Math.min(64, 20 + Math.sqrt(count) * 4.4),
      tone: toneOf(g !== undefined ? g.colors : []),
      major: false,
      er: 0,
    });
  }

  const byMass = [...stars].sort((a, b) => b.count - a.count);
  for (let i = 0; i < byMass.length && i < MAJOR_CAP; i += 1) {
    const s = byMass[i];
    if (s === undefined || s.count < 2) break;
    s.major = true;
  }

  for (const s of stars) {
    s.er = s.d / 2;
    starsByName.set(s.name, s);
  }

  const sparks: SparkData[] = [];
  let maxCount = 0;
  if (playlistsStore.ready) {
    for (const pl of playlistsStore.list()) {
      const tracks = playlistsStore.liveTracks(pl.tracks);
      const count = tracks.length;
      if (count > maxCount) maxCount = count;
      const weights = new Map<string, number>();
      for (const t of tracks) {
        const a = primaryOf(t);
        if (a === null) continue;
        weights.set(a, (weights.get(a) ?? 0) + 1);
      }
      const sources: SparkSource[] = [...weights.entries()]
        .map(([name, w]) => ({ name, w }))
        .sort((a, b) => b.w - a.w);
      let primary: Tone | null = null;
      let secondary: Tone | null = null;
      for (const src of sources) {
        const star = starsByName.get(src.name);
        if (star === undefined) continue;
        if (primary === null) primary = star.tone;
        else if (secondary === null) secondary = star.tone;
        if (primary !== null && secondary !== null) break;
      }
      const t1 = primary ?? { h: 226, s: 0.55 };
      const t2 = secondary ?? t1;
      const d = count === 0 ? 15 : Math.min(60, 18 + Math.log2(1 + count) * 7);
      sparks.push({ pl, count, d, node: { x: 0, y: 0, er: d / 2 + 8 }, t1, t2, sources });
    }
  }
  const maxSqrt = Math.sqrt(maxCount);
  for (const sp of sparks) {
    const rand = mulberry32(hashName(`halo\0${sp.pl.id}`));
    const n = sp.count === 0 || maxCount === 0 ? 0 : Math.sqrt(sp.count) / maxSqrt;
    let dist = HALO_MIN + (HALO_MAX - HALO_MIN) * (1 - n);
    let ang: number;
    const top = sp.sources[0];
    const totalW = sp.sources.reduce((s2, x) => s2 + x.w, 0);
    const domStar = top !== undefined && top.w * 2 >= totalW ? starsByName.get(top.name) : undefined;
    if (domStar !== undefined) ang = Math.atan2(domStar.y, domStar.x);
    else ang = rand() * Math.PI * 2;
    ang += (rand() - 0.5) * 0.075;
    dist *= 1 + (rand() - 0.5) * 0.11;
    sp.node.x = Math.cos(ang) * dist;
    sp.node.y = Math.sin(ang) * dist * WORLD_SQUASH;
  }
  resolveLayout(
    sparks.map((s) => s.node),
    0,
  );
  for (const sp of sparks) {
    const r = Math.hypot(sp.node.x, sp.node.y);
    const lo = HALO_MIN - 14;
    const hi = HALO_MAX + 40;
    if (r >= lo && r <= hi) continue;
    const f = (r < lo ? lo : hi) / (r || 1);
    sp.node.x *= f;
    sp.node.y *= f;
  }

  resolveLayout(stars, COURT_KEEP);
  paintPools(stars);
  paintHalos(stars, sparks);

  if (holeEl !== null) {
    attachLabel(
      holeEl,
      0,
      0,
      HOLE_D,
      'All songs',
      String(totalSongs),
      'hole',
      true,
    );
  }

  const starFrag = document.createDocumentFragment();
  for (const s of stars) {
    starsByName.set(s.name, s);
    const h = s.tone.h.toFixed(0);
    const sat = Math.round(s.tone.s * 100);
    const star = document.createElement('span');
    star.className = s.major ? 'uni-star major' : 'uni-star';
    star.dataset.name = s.name;
    star.style.left = `${(s.x + WORLD_W / 2).toFixed(1)}px`;
    star.style.top = `${(s.y + WORLD_H / 2).toFixed(1)}px`;
    star.style.setProperty('--d', s.d.toFixed(1));
    const hotS = 28 + randStop(s.name, 4) * 26;
    const hotL = (s.major ? 96 : 92) + randStop(s.name, 5) * (s.major ? 3 : 5);
    star.style.setProperty('--hot', `hsl(${h} ${Math.round(hotS)}% ${hotL.toFixed(0)}%)`);
    star.style.setProperty('--body', `hsl(${h} ${sat}% 64%)`);
    star.classList.add('breathe');
    star.style.setProperty('--bdur', `${(4.5 + randStop(s.name, 11) * 4).toFixed(2)}s`);
    star.style.setProperty('--bdel', `${(-randStop(s.name, 12) * 9).toFixed(2)}s`);
    starFrag.append(star);
    starEls.set(s.name, star);
    attachLabel(star, s.x, s.y, s.d, s.name, null, s.major ? 'major' : '');
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      appBus.emit('universe-open-artist', { name: s.name });
    });
  }
  starsLayer.append(starFrag);

  if (sparksLayer !== null) {
    const sparkFrag = document.createDocumentFragment();
    for (const sp of sparks) {
      const spark = document.createElement('span');
      spark.className = sp.count === 0 ? 'uni-spark ghost' : 'uni-spark';
      spark.style.left = `${(sp.node.x + WORLD_W / 2).toFixed(1)}px`;
      spark.style.top = `${(sp.node.y + WORLD_H / 2).toFixed(1)}px`;
      spark.style.setProperty('--d', sp.d.toFixed(1));
      spark.style.setProperty('--a', `hsl(${sp.t1.h.toFixed(0)} ${Math.round(Math.max(0.6, sp.t1.s) * 100)}% 66%)`);
      spark.style.setProperty('--b', `hsl(${sp.t2.h.toFixed(0)} ${Math.round(Math.max(0.6, sp.t2.s) * 100)}% 58%)`);
      spark.addEventListener('click', (e) => {
        e.stopPropagation();
        appBus.emit('universe-open-playlist', { id: sp.pl.id });
      });
      sparkFrag.append(spark);
      sparksByEl.set(spark, sp);
      attachLabel(
        spark,
        sp.node.x,
        sp.node.y,
        sp.d,
        sp.pl.name,
        `${sp.pl.name} · ${sp.count} song${sp.count === 1 ? '' : 's'}`,
        'spark',
      );
    }
    sparksLayer.append(sparkFrag);
  }

  applyTransforms();
  updateLabels();
  applyNow();
  lastStars = stars;
  frameOnce(stars);
}

function randStop(name: string, salt: number): number {
  const rand = mulberry32((hashName(name) ^ (0x9e3779b9 + salt * 0x85ebca6b)) >>> 0);
  return rand();
}

function buildSurface(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'universe';
  section.setAttribute('aria-label', 'Universe view');
  section.hidden = true;

  const plane = (cls: string, factor: number): HTMLElement => {
    const el = document.createElement('div');
    el.className = `uni-layer ${cls}`;
    section.append(el);
    layers.push({ el, factor });
    return el;
  };

  deepPlane = plane('uni-deep', 0.3);
  buildFieldStars(deepPlane, {
    count: 30,
    minSize: 0.9,
    maxSize: 1.8,
    minAlpha: 0.4,
    maxAlpha: 0.7,
    twinkles: 5,
    seed: SEED ^ 0xa1b2c3,
  });

  if (NEBULAE) {
    const nebLayer = plane('uni-neb', 0.55);
    const nebCv = makeCanvas(NEB_W, NEB_H);
    nebLayer.append(nebCv);
    nebCtx = nebCv.getContext('2d');
  }

  nearPlane = plane('uni-near', 0.7);
  buildFieldStars(nearPlane, {
    count: 40,
    minSize: 1.2,
    maxSize: 2.4,
    minAlpha: 0.55,
    maxAlpha: 0.95,
    twinkles: 8,
    seed: SEED ^ 0xc3d4e5,
  });

  const poolsLayer = plane('uni-pools', 1);
  const poolsCv = makeCanvas(POOL_W, POOL_H);
  poolsLayer.append(poolsCv);
  poolsCtx = poolsCv.getContext('2d');

  const haloLayer = plane('uni-halo', 1);
  const haloCv = makeCanvas(HALO_W, HALO_H);
  haloLayer.append(haloCv);
  haloCtx = haloCv.getContext('2d');

  const threadsLayer = plane('uni-threads', 1);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${WORLD_W} ${WORLD_H}`);
  svg.setAttribute('width', String(WORLD_W));
  svg.setAttribute('height', String(WORLD_H));
  threadsLayer.append(svg);
  threadSvg = svg;

  heartLayer = plane('uni-heart', 1);
  const swirl = makeCanvas(SWIRL_BMP, SWIRL_BMP);
  swirl.className = 'hole-swirl';
  heartLayer.append(swirl);
  swirlCtx = swirl.getContext('2d');
  const hole = document.createElement('button');
  hole.className = 'uni-hole';
  hole.type = 'button';
  hole.setAttribute('aria-label', 'All songs');
  const glow = document.createElement('span');
  glow.className = 'hole-glow';
  const ring = document.createElement('span');
  ring.className = 'hole-ring';
  const disc = document.createElement('span');
  disc.className = 'hole-disc';
  hole.append(glow, disc, ring);
  hole.addEventListener('click', (e) => {
    e.stopPropagation();
    appBus.emit('universe-open-all', {});
  });
  heartLayer.append(hole);
  holeEl = hole;

  starsLayer = plane('uni-stars', 1);
  sparksLayer = plane('uni-sparks', 1);

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
    if ((e.target as HTMLElement | null)?.closest?.('.uni-star, .uni-spark, .uni-hole') !== null) return;
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

  section.addEventListener('pointerover', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('.uni-star, .uni-spark, .uni-hole');
    setHot(el instanceof HTMLElement ? (el.dataset.label ?? null) : null);
    const sparkEl = (e.target as HTMLElement | null)?.closest?.('.uni-spark');
    if (sparkEl instanceof HTMLElement) showThreads(sparkEl);
    else clearThreads();
  });
  section.addEventListener('pointerout', (e) => {
    const ev = e as PointerEvent;
    const from = (ev.target as HTMLElement | null)?.closest?.('.uni-star, .uni-spark, .uni-hole');
    const to = (ev.relatedTarget as HTMLElement | null)?.closest?.('.uni-star, .uni-spark, .uni-hole');
    if (from !== null && from !== to) {
      setHot(null);
      clearThreads();
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
  onMoment((strength) => {
    if (!active) return;
    const artist = player.currentTrack !== null ? primaryOf(player.currentTrack) : null;
    if (artist === null) return;
    const el = starEls.get(artist);
    if (el === undefined) return;
    const now = performance.now();
    if (now - lastPulse < 280) return;
    lastPulse = now;
    const amp = 0.06 + strength * 0.1;
    el.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1)' },
        { transform: `translate(-50%, -50%) scale(${(1 + amp).toFixed(3)})`, offset: 0.3 },
        { transform: 'translate(-50%, -50%) scale(1)' },
      ],
      { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  });
  rebuildSky();
}

export function setUniverseVisible(on: boolean): void {
  if (surface === null || active === on) return;
  active = on;
  surface.hidden = !on;
  surface.classList.toggle('on', on);
  document.body.classList.toggle('universe-active', on);
  if (on) {
    if (!painted) {
      painted = true;
      paintSky();
      paintSwirl();
    }
    refreshRect();
    frameOnce(lastStars);
    updateLabels();
    wake();
  } else if (raf !== 0) {
    window.cancelAnimationFrame(raf);
    raf = 0;
  }
}
