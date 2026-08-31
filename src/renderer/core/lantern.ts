import { fx } from './fx';
import { appBus } from './appBus';

type LanternStateId = 'default';

interface LanternSpriteSpec {
  svg: string | null;
  size: number;
  hotspot: { x: number; y: number };
}

const STATE_SPECS: Record<LanternStateId, LanternSpriteSpec> = {
  default: { svg: null, size: 48, hotspot: { x: 24, y: 24 } },
};

const FALLBACK_ACCENT = '#8f97e8';
const HALO_STRENGTH = 0.7;
const CANVAS_Z = 999999;
const EASE = 0.3;
const CONVERGED = 0.01;
const VISIBLE_FLOOR = 0.02;
const ACCENT_CHASE_MS = 850;
const MOTE_CAP = 40;
const MOTE_FLANKED = true;
const MOTE_TRAVEL_MIN = 14;
const MOTE_TRAVEL_MAX = 24;
const MOTE_TTL_MIN = 0.9;
const MOTE_TTL_MAX = 1.6;
const BURST_TTL_MIN = 0.55;
const BURST_TTL_MAX = 1.05;
const BURST_MIN = 10;
const BURST_SPREAD = 5;
const ROUND_SIZE_MIN = 4;
const ROUND_SIZE_MAX = 8;
const STAR_SIZE_MIN = 6;
const STAR_SIZE_MAX = 10;
const MOTE_DAMP = 2.6;
const MOTE_VARIANTS = 6;
const TRAIL_Z = 999998;
const RIBBON_POINTS = 14;
const RIBBON_TTL = 0.45;
const RIBBON_WIDTH = 6.5;
const RIBBON_ALPHA = 0.55;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let enabled = true;
let active = false;
let raf = 0;
let x = -1000;
let y = -1000;
let alpha = 0;
let inside = false;
let inDrag = false;
let state: LanternStateId = 'default';
let accent = '';
let dpr = 0;
let chaseUntil = 0;
let blittedKey = '';
let paintedFade = '0';
let paintedPlace = '';
const sprites = new Map<string, HTMLCanvasElement>();
const pending = new Set<string>();

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damp: number;
  life: number;
  ttl: number;
  size: number;
  rot: number;
  spin: number;
  sprite: HTMLCanvasElement | null;
  source: 'cursor' | 'arrow';
}

const motes: Mote[] = [];
let moteIndex = 0;
let roundVariants: HTMLCanvasElement[] = [];
let starVariants: HTMLCanvasElement[] = [];
let trailCanvas: HTMLCanvasElement | null = null;
let trailCtx: CanvasRenderingContext2D | null = null;
let trailBounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
let travelled = 0;
let nextStep = MOTE_TRAVEL_MIN;
let lastTs = 0;
let sampleCtx: CanvasRenderingContext2D | null = null;
let clock = 0;
let ribbonWrite = 0;
const ribbon: Array<{ x: number; y: number; born: number }> = [];
const ribbonDraw: Array<{ x: number; y: number; born: number }> = [];

function readAccent(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--acc-a').trim() || FALLBACK_ACCENT;
}

function buildGlow(size: number, tone: string, ratio: number): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = Math.ceil(size * ratio);
  s.height = Math.ceil(size * ratio);
  const g = s.getContext('2d');
  if (g === null) return s;
  const r = s.width / 2;
  const mask = g.createRadialGradient(r, r, 0, r, r, r);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.55, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = mask;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'source-in';
  g.globalAlpha = HALO_STRENGTH;
  g.fillStyle = tone;
  g.fillRect(0, 0, s.width, s.height);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  const bloom = g.createRadialGradient(r, r, 0, r, r, r * 0.8);
  bloom.addColorStop(0, 'rgba(255,255,255,0.3)');
  bloom.addColorStop(0.55, 'rgba(255,255,255,0.12)');
  bloom.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = bloom;
  g.beginPath();
  g.arc(r, r, r * 0.8, 0, Math.PI * 2);
  g.fill();
  const core = g.createRadialGradient(r, r, 0, r, r, r * 0.55);
  core.addColorStop(0, 'rgba(255,255,255,0.95)');
  core.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.beginPath();
  g.arc(r, r, r * 0.55, 0, Math.PI * 2);
  g.fill();
  return s;
}

function tintTo(source: HTMLImageElement, size: number, ratio: number, tone: string): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = Math.ceil(size * ratio);
  s.height = Math.ceil(size * ratio);
  const g = s.getContext('2d');
  if (g === null) return s;
  g.drawImage(source, 0, 0, s.width, s.height);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = tone;
  g.fillRect(0, 0, s.width, s.height);
  return s;
}

function loadSprite(id: LanternStateId, spec: LanternSpriteSpec, tone: string, ratio: number): void {
  const key = `${id}|${tone}|${ratio}`;
  if (spec.svg === null) {
    sprites.set(key, buildGlow(spec.size, tone, ratio));
    return;
  }
  if (pending.has(key)) return;
  pending.add(key);
  const img = new Image();
  img.onload = () => {
    pending.delete(key);
    sprites.set(key, tintTo(img, spec.size, ratio, tone));
    rearm();
  };
  img.onerror = () => {
    pending.delete(key);
    sprites.set(key, buildGlow(spec.size, tone, ratio));
    rearm();
  };
  img.src = `data:image/svg+xml;utf8,${encodeURIComponent(spec.svg)}`;
}

function rebuildSprites(): void {
  sprites.clear();
  pending.clear();
  blittedKey = '';
  buildMoteSprites();
  for (const id of Object.keys(STATE_SPECS) as LanternStateId[]) {
    loadSprite(id, STATE_SPECS[id], accent, dpr);
  }
}

function currentSprite(): HTMLCanvasElement | null {
  return sprites.get(`${state}|${accent}|${dpr}`) ?? null;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const span = max - min;
  const s = l > 0.5 ? span / (2 - max - min) : span / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / span + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / span + 2) * 60;
  else h = ((rn - gn) / span + 4) * 60;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function accentRgb(value = accent): [number, number, number] {
  if (sampleCtx === null) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    sampleCtx = c.getContext('2d');
  }
  if (sampleCtx === null) return [143, 151, 232];
  sampleCtx.clearRect(0, 0, 1, 1);
  sampleCtx.fillStyle = value;
  sampleCtx.fillRect(0, 0, 1, 1);
  const d = sampleCtx.getImageData(0, 0, 1, 1).data;
  return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
}

export function songAccentHsl(value?: string): [number, number, number] {
  const [r, g, b] = value === undefined ? accentRgb() : accentRgb(value);
  return rgbToHsl(r, g, b);
}

function starPath(c: CanvasRenderingContext2D, r: number): void {
  const w = r * 0.2;
  c.moveTo(0, -r);
  c.quadraticCurveTo(w, -w, r, 0);
  c.quadraticCurveTo(w, w, 0, r);
  c.quadraticCurveTo(-w, w, -r, 0);
  c.quadraticCurveTo(-w, -w, 0, -r);
}

function makeRoundSprite(r: number, g: number, b: number): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = 48;
  s.height = 48;
  const c = s.getContext('2d');
  if (c === null) return s;
  const grad = c.createRadialGradient(24, 24, 0, 24, 24, 24);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
  grad.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.92)`);
  grad.addColorStop(0.75, `rgba(${r}, ${g}, ${b}, 0.38)`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  c.fillStyle = grad;
  c.beginPath();
  c.arc(24, 24, 24, 0, Math.PI * 2);
  c.fill();
  return s;
}

function makeStarSprite(r: number, g: number, b: number): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = 48;
  s.height = 48;
  const c = s.getContext('2d');
  if (c === null) return s;
  c.translate(24, 24);
  c.filter = 'blur(4px)';
  c.fillStyle = `rgba(${r}, ${g}, ${b}, 0.6)`;
  c.beginPath();
  starPath(c, 17);
  c.closePath();
  c.fill();
  c.filter = 'blur(1.5px)';
  c.fillStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
  c.beginPath();
  starPath(c, 19);
  c.closePath();
  c.fill();
  c.filter = 'none';
  c.fillStyle = `rgba(${r}, ${g}, ${b}, 0.95)`;
  c.beginPath();
  starPath(c, 19);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(255, 255, 255, 0.32)';
  c.beginPath();
  starPath(c, 8);
  c.closePath();
  c.fill();
  return s;
}

function buildMoteSprites(): void {
  roundVariants = [];
  starVariants = [];
  const [r, g, b] = accentRgb();
  const [h, s, l] = rgbToHsl(r, g, b);
  for (let i = 0; i < MOTE_VARIANTS; i++) {
    const t = i / (MOTE_VARIANTS - 1);
    const hue = h + (t - 0.5) * 28;
    const sat = Math.min(1, s * (1 + t * 0.3));
    const light = Math.max(0.12, l * (0.66 - t * 0.26));
    const [nr, ng, nb] = hslToRgb(hue, sat, light);
    roundVariants.push(makeRoundSprite(nr, ng, nb));
    starVariants.push(makeStarSprite(nr, ng, nb));
  }
}

function spawnMote(
  px: number,
  py: number,
  vx: number,
  vy: number,
  ttl: number,
  size: number,
  star: boolean,
  damp: number,
  source: 'cursor' | 'arrow',
): void {
  const pool = star ? starVariants : roundVariants;
  if (pool.length === 0) return;
  const m = motes[moteIndex % MOTE_CAP];
  if (m === undefined) return;
  moteIndex += 1;
  const art = pool[Math.floor(Math.random() * pool.length)];
  if (art === undefined) return;
  m.x = px;
  m.y = py;
  m.vx = vx;
  m.vy = vy;
  m.damp = damp;
  m.life = 0;
  m.ttl = ttl;
  m.size = size;
  m.rot = Math.random() * Math.PI * 2;
  m.spin = (Math.random() - 0.5) * 3;
  m.sprite = art;
  m.source = source;
}

function spawnTrailMote(dx: number, dy: number): void {
  if (inDrag || !fx.lantern || trailCanvas === null) return;
  const star = Math.random() < 0.5;
  const size = star
    ? STAR_SIZE_MIN + Math.random() * (STAR_SIZE_MAX - STAR_SIZE_MIN)
    : ROUND_SIZE_MIN + Math.random() * (ROUND_SIZE_MAX - ROUND_SIZE_MIN);
  if (MOTE_FLANKED) {
    const len = Math.hypot(dx, dy);
    const nx = len > 0 ? -dy / len : 0;
    const ny = len > 0 ? dx / len : 1;
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = 3 + Math.random() * 11;
    const along = (Math.random() - 0.5) * 8;
    const kick = (15 + Math.random() * 40) * side;
    const ux = len > 0 ? dx / len : 0;
    const uy = len > 0 ? dy / len : 0;
    spawnMote(
      x + nx * off * side + ux * along,
      y + ny * off * side + uy * along,
      dx * 1.4 + nx * kick + (Math.random() - 0.5) * 14,
      dy * 1.4 + ny * kick + (Math.random() - 0.5) * 14,
      MOTE_TTL_MIN + Math.random() * (MOTE_TTL_MAX - MOTE_TTL_MIN),
      size,
      star,
      MOTE_DAMP,
      'cursor',
    );
  } else {
    spawnMote(
      x + (Math.random() - 0.5) * 12,
      y + (Math.random() - 0.5) * 12,
      dx * 1.4 + (Math.random() - 0.5) * 36,
      dy * 1.4 + (Math.random() - 0.5) * 36,
      MOTE_TTL_MIN + Math.random() * (MOTE_TTL_MAX - MOTE_TTL_MIN),
      size,
      star,
      MOTE_DAMP,
      'cursor',
    );
  }
}

function spawnBurst(): void {
  if (inDrag || !fx.lantern || trailCanvas === null) return;
  const count = BURST_MIN + Math.floor(Math.random() * BURST_SPREAD);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 70 + Math.random() * 150;
    const star = Math.random() < 0.5;
    const size = star
      ? STAR_SIZE_MIN + Math.random() * (STAR_SIZE_MAX - STAR_SIZE_MIN)
      : ROUND_SIZE_MIN + Math.random() * (ROUND_SIZE_MAX - ROUND_SIZE_MIN);
    spawnMote(
      x + (Math.random() - 0.5) * 4,
      y + (Math.random() - 0.5) * 4,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      BURST_TTL_MIN + Math.random() * (BURST_TTL_MAX - BURST_TTL_MIN),
      size,
      star,
      MOTE_DAMP,
      'cursor',
    );
  }
}

function ribbonSample(px: number, py: number): void {
  if (!fx.lantern) return;
  const slot = ribbon[ribbonWrite % RIBBON_POINTS];
  if (slot === undefined) return;
  slot.x = px;
  slot.y = py;
  slot.born = clock;
  ribbonWrite += 1;
}

function drawTrail(dt: number): boolean {
  if (trailCanvas === null || trailCtx === null) return false;
  clock += dt;
  let alive = false;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const m of motes) {
    if (m.ttl <= 0 || m.sprite === null) continue;
    m.life += dt;
    if (m.life >= m.ttl) {
      m.ttl = 0;
      continue;
    }
    alive = true;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    const damp = Math.exp(-m.damp * dt);
    m.vx *= damp;
    m.vy *= damp;
    m.rot += m.spin * dt;
    const pad = m.size * dpr;
    const mx0 = m.x * dpr - pad;
    const my0 = m.y * dpr - pad;
    const mx1 = m.x * dpr + pad;
    const my1 = m.y * dpr + pad;
    if (mx0 < x0) x0 = mx0;
    if (my0 < y0) y0 = my0;
    if (mx1 > x1) x1 = mx1;
    if (my1 > y1) y1 = my1;
  }
  ribbonDraw.length = 0;
  for (const p of ribbon) {
    if (p.born < 0) continue;
    if (clock - p.born > RIBBON_TTL) {
      p.born = -1;
      continue;
    }
    ribbonDraw.push(p);
  }
  if (ribbonDraw.length >= 2) alive = true;
  if (!alive) {
    if (trailBounds !== null) {
      trailCtx.clearRect(trailBounds.x0, trailBounds.y0, trailBounds.x1 - trailBounds.x0, trailBounds.y1 - trailBounds.y0);
      trailBounds = null;
    }
    return false;
  }
  const ribbonPad = (RIBBON_WIDTH + 6) * dpr;
  for (const p of ribbonDraw) {
    const px0 = p.x * dpr - ribbonPad;
    const py0 = p.y * dpr - ribbonPad;
    const px1 = p.x * dpr + ribbonPad;
    const py1 = p.y * dpr + ribbonPad;
    if (px0 < x0) x0 = px0;
    if (py0 < y0) y0 = py0;
    if (px1 > x1) x1 = px1;
    if (py1 > y1) y1 = py1;
  }
  const bx0 = trailBounds === null ? x0 : Math.min(trailBounds.x0, x0);
  const by0 = trailBounds === null ? y0 : Math.min(trailBounds.y0, y0);
  const bx1 = trailBounds === null ? x1 : Math.max(trailBounds.x1, x1);
  const by1 = trailBounds === null ? y1 : Math.max(trailBounds.y1, y1);
  trailCtx.clearRect(bx0, by0, bx1 - bx0, by1 - by0);
  if (ribbonDraw.length >= 2) {
    ribbonDraw.sort((a, b) => a.born - b.born);
    trailCtx.strokeStyle = accent;
    trailCtx.lineCap = 'round';
    trailCtx.lineJoin = 'round';
    for (let i = 1; i < ribbonDraw.length; i++) {
      const a = ribbonDraw[i - 1];
      const b = ribbonDraw[i];
      if (a === undefined || b === undefined) continue;
      const k = 1 - Math.min(1, (clock - b.born) / RIBBON_TTL);
      trailCtx.globalAlpha = RIBBON_ALPHA * k;
      trailCtx.lineWidth = 1.2 + (RIBBON_WIDTH - 1.2) * k;
      trailCtx.beginPath();
      trailCtx.moveTo(a.x, a.y);
      trailCtx.lineTo(b.x, b.y);
      trailCtx.stroke();
    }
  }
  for (const m of motes) {
    if (m.ttl <= 0 || m.sprite === null) continue;
    const a = Math.sin(Math.PI * (m.life / m.ttl)) * 0.9;
    trailCtx.globalAlpha = a;
    trailCtx.save();
    trailCtx.translate(m.x, m.y);
    trailCtx.rotate(m.rot);
    trailCtx.drawImage(m.sprite, -m.size / 2, -m.size / 2, m.size, m.size);
    trailCtx.restore();
  }
  trailCtx.globalAlpha = 1;
  trailBounds = { x0: bx0, y0: by0, x1: bx1, y1: by1 };
  return true;
}

function rearm(): void {
  if (raf === 0) raf = requestAnimationFrame(frame);
}

function reevaluate(under: Element | null): void {
  const now =
    under !== null &&
    under.closest('.window-drag') !== null &&
    under.closest('.no-drag') === null;
  if (now === inDrag) return;
  inDrag = now;
  rearm();
}

function syncSprite(): void {
  if (canvas === null || ctx === null) return;
  const sprite = currentSprite();
  if (sprite === null) return;
  const key = `${state}|${accent}|${dpr}`;
  if (key === blittedKey) return;
  blittedKey = key;
  canvas.width = sprite.width;
  canvas.height = sprite.height;
  canvas.style.width = `${sprite.width / dpr}px`;
  canvas.style.height = `${sprite.height / dpr}px`;
  ctx.drawImage(sprite, 0, 0);
}

function frame(ts: number): void {
  raf = 0;
  if (!active || canvas === null) return;
  const dt = lastTs === 0 ? 0.016 : Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;
  if (performance.now() < chaseUntil) {
    const next = readAccent();
    if (next !== accent) {
      accent = next;
      rebuildSprites();
    }
    rearm();
  }
  const target = inside && !inDrag ? 1 : 0;
  alpha += (target - alpha) * EASE;
  if (Math.abs(target - alpha) < CONVERGED) alpha = target;
  syncSprite();
  const shown = alpha > VISIBLE_FLOOR ? alpha : 0;
  const fade = String(Math.round(shown * 100) / 100);
  if (fade !== paintedFade) {
    paintedFade = fade;
    canvas.style.opacity = fade;
  }
  const spec = STATE_SPECS[state];
  const place = `translate3d(${(x - spec.hotspot.x).toFixed(1)}px, ${(y - spec.hotspot.y).toFixed(1)}px, 0)`;
  if (place !== paintedPlace) {
    paintedPlace = place;
    canvas.style.transform = place;
  }
  const trailAlive = drawTrail(dt);
  if (alpha !== target || trailAlive) rearm();
}

function applyActive(): void {
  const on = enabled;
  if (on === active) return;
  active = on;
  document.documentElement.classList.toggle('particle-cursor', on);
  if (canvas !== null) canvas.style.display = on ? 'block' : 'none';
  if (!on) {
    alpha = 0;
    paintedFade = '0';
    if (canvas !== null) canvas.style.opacity = '0';
    for (const m of motes) m.ttl = 0;
    if (trailCanvas !== null && trailCtx !== null) {
      trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    }
    trailBounds = null;
  }
  if (on) {
    chaseUntil = performance.now() + 100;
    rearm();
  }
}

export const lantern = {
  init(): void {
    if (canvas !== null) return;
    canvas = document.createElement('canvas');
    canvas.id = 'lantern-canvas';
    ctx = canvas.getContext('2d');
    dpr = window.devicePixelRatio || 1;
    document.body.append(canvas);
    trailCanvas = document.createElement('canvas');
    trailCanvas.id = 'lantern-trail';
    trailCanvas.width = Math.ceil(window.innerWidth * dpr);
    trailCanvas.height = Math.ceil(window.innerHeight * dpr);
    trailCtx = trailCanvas.getContext('2d');
    if (trailCtx !== null) trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    document.body.append(trailCanvas);
    for (let i = 0; i < MOTE_CAP; i++) {
      motes.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        damp: MOTE_DAMP,
        life: 0,
        ttl: 0,
        size: 0,
        rot: 0,
        spin: 0,
        sprite: null,
        source: 'cursor',
      });
    }
    for (let i = 0; i < RIBBON_POINTS; i++) {
      ribbon.push({ x: 0, y: 0, born: -1 });
    }
    accent = readAccent();
    rebuildSprites();

    const style = document.createElement('style');
    style.textContent =
      'html.particle-cursor, html.particle-cursor body, html.particle-cursor body * { cursor: none !important; }' +
      "html.particle-cursor body input[type='text'], html.particle-cursor body input[type='search'], html.particle-cursor body input[type='email'], html.particle-cursor body input[type='url'], html.particle-cursor body input[type='password'], html.particle-cursor body input[type='number'], html.particle-cursor body textarea { cursor: text !important; }" +
      `#lantern-canvas { position: fixed; left: 0; top: 0; z-index: ${CANVAS_Z}; pointer-events: none; will-change: transform, opacity; }` +
      `#lantern-trail { position: fixed; inset: 0; z-index: ${TRAIL_Z}; pointer-events: none; }`;
    document.head.append(style);

    window.addEventListener('pointermove', (e) => {
      const px = x;
      const py = y;
      x = e.clientX;
      y = e.clientY;
      inside = true;
      reevaluate(e.target instanceof Element ? e.target : null);
      if (px > -500) {
        travelled += Math.hypot(x - px, y - py);
        while (travelled >= nextStep) {
          travelled -= nextStep;
          nextStep = MOTE_TRAVEL_MIN + Math.random() * (MOTE_TRAVEL_MAX - MOTE_TRAVEL_MIN);
          spawnTrailMote(x - px, y - py);
          if (!inDrag) ribbonSample(x, y);
        }
      } else {
        travelled = 0;
      }
      rearm();
    }, { passive: true });

    window.addEventListener('pointerdown', (e) => {
      x = e.clientX;
      y = e.clientY;
      inside = true;
      reevaluate(e.target instanceof Element ? e.target : null);
      if (!active || inDrag) return;
      rearm();
      spawnBurst();
    });

    document.addEventListener('pointerout', (e) => {
      if (e.relatedTarget !== null) return;
      inside = false;
      rearm();
    });

    window.addEventListener('blur', () => {
      inside = false;
      rearm();
    });

    window.addEventListener('resize', () => {
      const prev = dpr;
      dpr = window.devicePixelRatio || 1;
      if (dpr !== prev) {
        accent = readAccent();
        rebuildSprites();
      }
      if (trailCanvas !== null) {
        trailCanvas.width = Math.ceil(window.innerWidth * dpr);
        trailCanvas.height = Math.ceil(window.innerHeight * dpr);
        if (trailCtx !== null) trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      trailBounds = null;
      reevaluate(document.elementFromPoint(x, y));
      rearm();
    });

    new MutationObserver(() => {
      chaseUntil = performance.now() + ACCENT_CHASE_MS;
      rearm();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

    const topbar = document.getElementById('topbar');
    if (topbar !== null) {
      new MutationObserver(() => {
        reevaluate(document.elementFromPoint(x, y));
      }).observe(topbar, { attributes: true, attributeFilter: ['class'] });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'F8') {
        enabled = !enabled;
        applyActive();
      }
    });

    appBus.on('motion-flags', () => applyActive());

    applyActive();
  },

  setState(id: LanternStateId): void {
    if (STATE_SPECS[id] === undefined || id === state) return;
    state = id;
    rearm();
  },

  streamMote(px: number, py: number, side: number): void {
    if (trailCanvas === null || !fx.lantern) return;
    const speed = 70 + Math.random() * 100;
    spawnMote(
      px + (Math.random() - 0.5) * 6,
      py + (Math.random() - 0.5 + Math.random() - 0.5) * 32,
      side * speed,
      (Math.random() - 0.5) * 30,
      2.8 + Math.random() * 1.2,
      4.5 + Math.random() * 4,
      Math.random() < 0.5,
      1.1 + Math.random() * 0.3,
      'arrow',
    );
  },

  burstMotes(px: number, py: number, side: number, strength: number): void {
    if (trailCanvas === null || !fx.lantern) return;
    const count = 2 + (strength > 0.6 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      spawnMote(
        px + (Math.random() - 0.5) * 14,
        py + (Math.random() - 0.5) * 30,
        side * ((40 + Math.random() * 30) * (0.7 + strength * 0.5)),
        (Math.random() - 0.5) * 24,
        1.8 + Math.random() * 0.7,
        5 + Math.random() * 4.5,
        Math.random() < 0.5,
        MOTE_DAMP,
        'arrow',
      );
    }
  },

  clearArrowMotes(): void {
    for (const m of motes) {
      if (m.source === 'arrow') m.ttl = 0;
    }
    rearm();
  },

  sync(): void {
    applyActive();
  },
};
