import '../styles/universe.css';

const WORLD_W = 3600;
const WORLD_H = 2200;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 3;
const ZOOM_WHEEL = 0.0016;
const EASE = 0.22;
const PARK_EPSILON = 0.08;
const ORBIT_MIN = 340;
const ORBIT_MAX = 700;
const ABS_WEIGHT_MAX = 300;
const WORLD_SQUASH = 0.5;
const OVAL_TILT = 0.12;
const ANGLE_NOISE = 0.3;
const SCATTER = 0.8;
const GROWTH_CAP = 1.6;
const ARC_JITTER = 0.7;
const COURT_KEEP = 640;

export interface PlacementNode {
  x: number;
  y: number;
  er: number;
}

export interface ArtistPlacement {
  name: string;
  count: number;
  x: number;
  y: number;
  er: number;
}

let surface: HTMLElement | null = null;
let active = false;
let raf = 0;
let dragging = false;
let lastPointer = { x: 0, y: 0 };
let lastZoomVar = '';
let viewRect: { width: number; height: number } | null = null;

const cam = { x: 0, y: 0, z: 1 };
const target = { x: 0, y: 0, z: 1 };

export function hashName(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weightAt(count: number): number {
  return ORBIT_MAX - (Math.log10(Math.max(1, count)) / Math.log10(ABS_WEIGHT_MAX)) * (ORBIT_MAX - ORBIT_MIN);
}

export function alphabeticalAngles(names: string[]): Map<string, number> {
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

export function resolveLayout(nodes: PlacementNode[], keepBase: number): void {
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

export function layoutArtists(entries: Array<{ name: string; count: number }>): ArtistPlacement[] {
  const counts = new Map(entries.map((e) => [e.name, e.count] as const));
  const names = [...entries.map((e) => e.name)].sort((a, b) => {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    return la === lb ? (a < b ? -1 : a > b ? 1 : 0) : la < lb ? -1 : 1;
  });
  const angles = alphabeticalAngles(names);
  const growth = Math.min(GROWTH_CAP, Math.max(1, Math.sqrt(names.length / 12)));
  const tiltC = Math.cos(OVAL_TILT);
  const tiltS = Math.sin(OVAL_TILT);
  const stars: ArtistPlacement[] = [];
  for (const name of names) {
    const count = counts.get(name) ?? 1;
    const rand = mulberry32((hashName(name) ^ 0x9e3779b9) >>> 0);
    const angle = (angles.get(name) ?? 0) + (rand() - 0.5) * 2 * ANGLE_NOISE;
    const orbit = weightAt(count) * growth * (1 + (rand() - 0.5) * SCATTER);
    const lobed = orbit * (1 + 0.16 * Math.sin(2 * angle + 1.3) + 0.11 * Math.sin(3 * angle + 4.1));
    const ex = Math.cos(angle) * lobed;
    const ey = Math.sin(angle) * lobed * WORLD_SQUASH;
    const d = Math.min(64, 20 + Math.sqrt(count) * 4.4);
    stars.push({
      name,
      count,
      x: ex * tiltC - ey * tiltS,
      y: ex * tiltS + ey * tiltC,
      er: d / 2,
    });
  }
  resolveLayout(stars, COURT_KEEP);
  return stars;
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

function applyCamera(): void {
  const q = cam.z.toFixed(2);
  if (q !== lastZoomVar && surface !== null) {
    lastZoomVar = q;
    surface.style.setProperty('--uni-zoom', q);
  }
}

function tick(): void {
  cam.x += (target.x - cam.x) * EASE;
  cam.y += (target.y - cam.y) * EASE;
  cam.z += (target.z - cam.z) * EASE;
  applyCamera();
  if (
    Math.abs(target.x - cam.x) < PARK_EPSILON &&
    Math.abs(target.y - cam.y) < PARK_EPSILON &&
    Math.abs(target.z - cam.z) < 0.001
  ) {
    cam.x = target.x;
    cam.y = target.y;
    cam.z = target.z;
    applyCamera();
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

function buildSurface(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'universe';
  section.setAttribute('aria-label', 'Universe view');
  section.hidden = true;

  section.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = section.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, cam.z * Math.exp(-e.deltaY * ZOOM_WHEEL));
  }, { passive: false });

  section.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
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

  return section;
}

export function initUniverse(): void {
  if (surface !== null) return;
  surface = buildSurface();
  document.body.append(surface);
  refreshRect();
  applyCamera();
  window.addEventListener('resize', refreshRect);
}

export function setUniverseVisible(on: boolean): void {
  if (surface === null || active === on) return;
  active = on;
  surface.hidden = !on;
  surface.classList.toggle('on', on);
  document.body.classList.toggle('universe-active', on);
  if (on) {
    refreshRect();
    wake();
  } else if (raf !== 0) {
    window.cancelAnimationFrame(raf);
    raf = 0;
  }
}
