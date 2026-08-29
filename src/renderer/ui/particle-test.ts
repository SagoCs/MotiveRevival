const SIZE = 60;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let sprite: HTMLCanvasElement | null = null;
let x = -200;
let y = -200;
let raf = 0;
let enabled = false;
let alpha = 1;

function buildSprite(): void {
  if (ctx === null) return;
  const dpr = window.devicePixelRatio || 1;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--acc-a').trim() || '#8f97e8';
  const size = Math.ceil(SIZE * dpr);
  const s = document.createElement('canvas');
  s.width = size;
  s.height = size;
  const sctx = s.getContext('2d');
  if (sctx === null) return;
  const r = size / 2;
  const halo = sctx.createRadialGradient(r, r, 0, r, r, r);
  halo.addColorStop(0, accent);
  halo.addColorStop(0.55, accent);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.globalAlpha = 0.55;
  sctx.fillStyle = halo;
  sctx.beginPath();
  sctx.arc(r, r, r, 0, Math.PI * 2);
  sctx.fill();
  const core = sctx.createRadialGradient(r, r, 0, r, r, r * 0.55);
  core.addColorStop(0, 'rgba(255,255,255,0.95)');
  core.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  sctx.globalAlpha = 1;
  sctx.fillStyle = core;
  sctx.beginPath();
  sctx.arc(r, r, r * 0.55, 0, Math.PI * 2);
  sctx.fill();
  sprite = s;
}

function draw(): void {
  if (!enabled || ctx === null || canvas === null) {
    raf = 0;
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const under = document.elementFromPoint(x, y);
  const inDragStrip =
    under !== null &&
    under.closest('.window-drag') !== null &&
    under.closest('.no-drag') === null;
  const target = inDragStrip ? 0 : 1;
  alpha += (target - alpha) * 0.3;
  if (sprite !== null && x >= 0 && alpha > 0.02) {
    const dpr = window.devicePixelRatio || 1;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, x * dpr - (SIZE * dpr) / 2, y * dpr - (SIZE * dpr) / 2, SIZE * dpr, SIZE * dpr);
    ctx.globalAlpha = 1;
  }
  raf = requestAnimationFrame(draw);
}

function ensureLoop(): void {
  if (raf === 0) raf = requestAnimationFrame(draw);
}

function setEnabled(on: boolean): void {
  enabled = on;
  document.documentElement.classList.toggle('particle-cursor', on);
  if (canvas !== null) canvas.style.display = on ? 'block' : 'none';
  if (on) {
    buildSprite();
    ensureLoop();
  }
}

export function initParticleTest(): void {
  canvas = document.createElement('canvas');
  canvas.id = 'particle-test-canvas';
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.ceil(window.innerWidth * dpr);
  canvas.height = Math.ceil(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  document.body.append(canvas);
  ctx = canvas.getContext('2d');

  const style = document.createElement('style');
  style.textContent =
    'html.particle-cursor, html.particle-cursor body, html.particle-cursor body *:not(input):not(textarea) { cursor: none !important; }' +
    '#particle-test-canvas { position: fixed; inset: 0; z-index: 999999; pointer-events: none; }';
  document.head.append(style);

  window.addEventListener('pointermove', (e) => {
    x = e.clientX;
    y = e.clientY;
    ensureLoop();
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (canvas === null || ctx === null) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(window.innerWidth * ratio);
    canvas.height = Math.ceil(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  });

  const observer = new MutationObserver(() => buildSprite());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F8') setEnabled(!enabled);
  });

  setEnabled(true);
}
