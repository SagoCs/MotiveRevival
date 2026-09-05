import '../styles/universe.css';

const WORLD_W = 3600;
const WORLD_H = 2200;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 3;
const ZOOM_WHEEL = 0.0016;
const EASE = 0.22;
const PARK_EPSILON = 0.08;
const SEED = 20260905;

interface LayerSpec {
  factor: number;
  count: number;
  bright: number;
  cls: string;
}

const LAYERS: LayerSpec[] = [
  { factor: 0.35, count: 26, bright: 2, cls: 'uni-far' },
  { factor: 0.65, count: 34, bright: 3, cls: 'uni-mid' },
  { factor: 1, count: 26, bright: 4, cls: 'uni-near' },
];

interface Layer {
  el: HTMLElement;
  factor: number;
}

let surface: HTMLElement | null = null;
let layers: Layer[] = [];
let active = false;
let raf = 0;
let dragging = false;
let lastPointer = { x: 0, y: 0 };

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
}

function tick(): void {
  cam.x += (target.x - cam.x) * EASE;
  cam.y += (target.y - cam.y) * EASE;
  cam.z += (target.z - cam.z) * EASE;
  applyTransforms();
  if (
    Math.abs(target.x - cam.x) < PARK_EPSILON &&
    Math.abs(target.y - cam.y) < PARK_EPSILON &&
    Math.abs(target.z - cam.z) < 0.001
  ) {
    cam.x = target.x;
    cam.y = target.y;
    cam.z = target.z;
    applyTransforms();
    raf = 0;
    return;
  }
  raf = window.requestAnimationFrame(tick);
}

function wake(): void {
  if (raf === 0) raf = window.requestAnimationFrame(tick);
}

function zoomAt(localX: number, localY: number, nextZoom: number): void {
  const rect = surface?.getBoundingClientRect();
  if (!rect) return;
  const cx = rect.width / 2;
  const cy = rect.height / 2;
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
    speck.style.setProperty('--s', (bright ? 3.6 + rand() * 2.4 : 1.2 + rand() * 1.8).toFixed(2));
    speck.style.setProperty('--o', (0.2 + rand() * 0.6).toFixed(2));
    frag.append(speck);
  }
  layer.append(frag);
}

function buildSurface(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'universe';
  section.setAttribute('aria-label', 'Universe view');
  section.hidden = true;

  const field = document.createElement('div');
  field.className = 'uni-field';
  section.append(field);

  for (const spec of LAYERS) {
    const layer = document.createElement('div');
    layer.className = `uni-layer ${spec.cls}`;
    buildSpecks(layer, spec);
    section.append(layer);
    layers.push({ el: layer, factor: spec.factor });
  }

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
  applyTransforms();
}

export function setUniverseVisible(on: boolean): void {
  if (surface === null || active === on) return;
  active = on;
  surface.hidden = !on;
  surface.classList.toggle('on', on);
  if (on) wake();
  else if (raf !== 0) {
    window.cancelAnimationFrame(raf);
    raf = 0;
  }
}
