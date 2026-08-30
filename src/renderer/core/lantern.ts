import { fx } from './fx';
import { appBus } from './appBus';

type LanternStateId = 'default';

interface LanternSpriteSpec {
  svg: string | null;
  size: number;
  hotspot: { x: number; y: number };
}

const STATE_SPECS: Record<LanternStateId, LanternSpriteSpec> = {
  default: { svg: null, size: 60, hotspot: { x: 30, y: 30 } },
};

const FALLBACK_ACCENT = '#8f97e8';
const HALO_STRENGTH = 0.7;
const CANVAS_Z = 999999;
const EASE = 0.3;
const CONVERGED = 0.01;
const VISIBLE_FLOOR = 0.02;
const ACCENT_CHASE_MS = 850;

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
  for (const id of Object.keys(STATE_SPECS) as LanternStateId[]) {
    loadSprite(id, STATE_SPECS[id], accent, dpr);
  }
}

function currentSprite(): HTMLCanvasElement | null {
  return sprites.get(`${state}|${accent}|${dpr}`) ?? null;
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

function frame(): void {
  raf = 0;
  if (!active || canvas === null) return;
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
  if (alpha !== target) rearm();
}

function applyActive(): void {
  const on = enabled && fx.lantern;
  if (on === active) return;
  active = on;
  document.documentElement.classList.toggle('particle-cursor', on);
  if (canvas !== null) canvas.style.display = on ? 'block' : 'none';
  if (!on) {
    alpha = 0;
    paintedFade = '0';
    if (canvas !== null) canvas.style.opacity = '0';
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
    accent = readAccent();
    rebuildSprites();

    const style = document.createElement('style');
    style.textContent =
      'html.particle-cursor, html.particle-cursor body, html.particle-cursor body *:not(input):not(textarea) { cursor: none !important; }' +
      `#lantern-canvas { position: fixed; left: 0; top: 0; z-index: ${CANVAS_Z}; pointer-events: none; will-change: transform, opacity; }`;
    document.head.append(style);

    window.addEventListener('pointermove', (e) => {
      x = e.clientX;
      y = e.clientY;
      inside = true;
      reevaluate(e.target instanceof Element ? e.target : null);
      rearm();
    }, { passive: true });

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

  sync(): void {
    applyActive();
  },
};
