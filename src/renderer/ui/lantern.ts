import { fx } from '../core/fx';
import { uiTheme } from '../core/uiTheme';

type CursorVariant = 'default' | 'interactive' | 'drag' | 'edgeLeft' | 'edgeRight' | 'settle';

type Mote = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  size: number;
  color: string;
};

type Orbiter = {
  angle: number;
  speed: number;
  radius: number;
  size: number;
  dir: number;
};

const INTERACTIVE_SELECTOR = 'button, a, [data-interactive]';
const TEXT_SELECTOR = 'input, textarea';
const DRAG_SELECTOR = '.window-drag, #carousel';
const EDGE_ZONE = 28;
const IDLE_MS = 10000;
const MOTE_CAP = 14;
const SPRITE_SIZE = 32;
const VARIANTS: CursorVariant[] = [
  'default',
  'interactive',
  'drag',
  'edgeLeft',
  'edgeRight',
  'settle',
];

function cursorSvg(color: string, variant: CursorVariant): string {
  const dim = variant === 'settle';
  const coreO = dim ? 0.38 : 1;
  const bloomO = dim ? 0.12 : 0.3;
  const defs: string[] = [];
  const body: string[] = [];

  defs.push(
    `<radialGradient id="lb" cx="50%" cy="50%" r="50%">` +
      `<stop offset="0%" stop-color="${color}" stop-opacity="${bloomO}"/>` +
      `<stop offset="46%" stop-color="${color}" stop-opacity="${bloomO * 0.38}"/>` +
      `<stop offset="72%" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
  );
  body.push(`<circle cx="32" cy="32" r="28" fill="url(#lb)"/>`);

  defs.push(
    `<radialGradient id="lc" cx="50%" cy="50%" r="50%">` +
      `<stop offset="0%" stop-color="${color}" stop-opacity="${coreO}"/>` +
      `<stop offset="24%" stop-color="${color}" stop-opacity="${coreO}"/>` +
      `<stop offset="62%" stop-color="${color}" stop-opacity="${0.42 * coreO}"/>` +
      `<stop offset="100%" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
  );
  body.push(`<circle cx="32" cy="32" r="5.5" fill="url(#lc)"/>`);

  if (variant === 'interactive') {
    body.push(
      `<circle cx="32" cy="32" r="16" fill="none" stroke="${color}" stroke-opacity="0.9" stroke-width="0.75"/>`,
    );
  } else if (variant === 'drag') {
    body.push(
      `<circle cx="32" cy="32" r="12" fill="none" stroke="${color}" stroke-opacity="1" stroke-width="1"/>`,
    );
  } else if (variant === 'edgeLeft' || variant === 'edgeRight') {
    const dir = variant === 'edgeLeft' ? -1 : 1;
    const cx = 32 + dir * 13;
    body.push(
      `<path d="M ${cx - dir * 2.6} 29 L ${cx + dir * 2.6} 32 L ${cx - dir * 2.6} 35" fill="none" ` +
        `stroke="${color}" stroke-opacity="0.9" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<defs>${defs.join('')}</defs>${body.join('')}</svg>`
  );
}

function cursorValue(svg: string): string {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 32 32, none`;
}

class LanternService {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private x = 0;
  private y = 0;
  private prevX = 0;
  private prevY = 0;
  private speed = 0;
  private lastMoveTs = 0;
  private moveTarget: Element | null = null;

  private seen = false;
  private focused = true;
  private down = false;
  private overText = false;
  private overInteractive = false;
  private overDrag = false;
  private edgeSide: 'left' | 'right' | null = null;

  private motes: Mote[] = [];
  private orbiters: Orbiter[] = [];
  private sprites = new Map<string, HTMLCanvasElement>();
  private spriteSize = SPRITE_SIZE;
  private settling = false;
  private idleTimer = 0;
  private raf = 0;
  private lastT = 0;
  private cursorAccent = '';
  private accentObserver: MutationObserver | null = null;
  private rootClasses = new Set<string>();

  init(): void {
    const canvas = document.createElement('canvas');
    canvas.id = 'lantern-motes';
    document.body.append(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('mouseleave', this.onLeave);
    document.addEventListener('mouseenter', this.onEnter);
    this.onResize();
    this.syncCursor();
    this.accentObserver = new MutationObserver(() => this.syncCursor());
    this.accentObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
  }

  private get active(): boolean {
    return fx.lantern && this.seen && this.focused;
  }

  private syncCursor(): void {
    const accent = uiTheme.current().accent.a;
    if (accent === this.cursorAccent) return;
    this.cursorAccent = accent;
    const style = document.documentElement.style;
    for (const variant of VARIANTS) {
      style.setProperty(`--lc-${variant}`, cursorValue(cursorSvg(accent, variant)));
    }
  }

  private setRootClass(name: string, on: boolean): void {
    if (on === this.rootClasses.has(name)) return;
    if (on) this.rootClasses.add(name);
    else this.rootClasses.delete(name);
    document.documentElement.classList.toggle(name, on);
  }

  private recompute(): void {
    let variant: CursorVariant = 'default';
    if (!this.active || this.overText) variant = 'default';
    else if (this.overDrag && this.down) variant = 'drag';
    else if (this.down && this.overInteractive) variant = 'interactive';
    else if (this.overInteractive) variant = 'interactive';
    else if (this.edgeSide === 'left') variant = 'edgeLeft';
    else if (this.edgeSide === 'right') variant = 'edgeRight';
    else if (this.settling) variant = 'settle';

    this.setRootClass('lantern-interactive', variant === 'interactive');
    this.setRootClass('lantern-drag', variant === 'drag');
    this.setRootClass('lantern-edge-left', variant === 'edgeLeft');
    this.setRootClass('lantern-edge-right', variant === 'edgeRight');
    this.setRootClass('lantern-settle', variant === 'settle');
  }

  private wake(): void {
    this.lastMoveTs = performance.now();
    if (this.settling) {
      this.settling = false;
      this.orbiters = [];
    }
    if (this.idleTimer === 0) {
      this.idleTimer = window.setTimeout(() => this.onIdleCheck(), IDLE_MS);
    }
  }

  private onIdleCheck(): void {
    this.idleTimer = 0;
    const remain = IDLE_MS - (performance.now() - this.lastMoveTs);
    if (remain > 0) {
      this.idleTimer = window.setTimeout(() => this.onIdleCheck(), remain);
      return;
    }
    this.startSettle();
  }

  private startSettle(): void {
    if (!fx.lantern || !fx.pulse || this.down || this.settling) return;
    this.settling = true;
    this.orbiters = [
      { angle: 0, speed: (Math.PI * 2) / 7000, radius: 15, size: 5, dir: 1 },
      { angle: Math.PI, speed: (Math.PI * 2) / 11000, radius: 24, size: 4, dir: -1 },
    ];
    this.recompute();
    this.ensureLoop();
  }

  private ensureLoop(): void {
    if (this.raf !== 0) return;
    this.lastT = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    const dt = this.lastT === 0 ? 16 : Math.min(64, now - this.lastT);
    this.lastT = now;
    const dtSec = dt / 1000;

    const dx = this.x - this.prevX;
    const dy = this.y - this.prevY;
    const instant = Math.hypot(dx, dy) / Math.max(dtSec, 0.001);
    this.speed = this.speed * 0.65 + instant * 0.35;
    this.prevX = this.x;
    this.prevY = this.y;

    const target = this.moveTarget;
    this.overText = target?.closest(TEXT_SELECTOR) !== null;
    this.overInteractive = target?.closest(INTERACTIVE_SELECTOR) !== null;
    this.overDrag = target?.closest(DRAG_SELECTOR) !== null;
    this.edgeSide =
      this.x < EDGE_ZONE ? 'left' : this.x > window.innerWidth - EDGE_ZONE ? 'right' : null;
    this.recompute();

    if (this.active && fx.pulse && !this.overText && this.speed > 20) {
      this.spawn(dx, dy, Math.max(1, Math.min(3, Math.round(this.speed / 550))));
    }

    this.draw(dtSec);

    if (this.motes.length === 0 && !this.settling) {
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private spawn(dx: number, dy: number, count: number): void {
    const color = uiTheme.current().accent.a;
    for (let i = 0; i < count && this.motes.length < MOTE_CAP; i++) {
      this.motes.push({
        x: this.x + (Math.random() * 12 - 6),
        y: this.y + (Math.random() * 12 - 6),
        vx: -(dx * 0.06) + (Math.random() * 18 - 9),
        vy: -(dy * 0.06) - 26 - Math.random() * 20,
        age: 0,
        ttl: 620 + Math.random() * 280,
        size: 5 + Math.random() * 5,
        color,
      });
    }
  }

  private draw(dtSec: number): void {
    const ctx = this.ctx;
    if (ctx === null || this.canvas === null) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const alive: Mote[] = [];
    for (const mote of this.motes) {
      mote.age += dtSec * 1000;
      if (mote.age >= mote.ttl) continue;
      mote.x += mote.vx * dtSec;
      mote.y += mote.vy * dtSec;
      alive.push(mote);
    }
    this.motes = alive;

    for (const mote of this.motes) {
      const k = 1 - mote.age / mote.ttl;
      const sprite = this.spriteFor(mote.color);
      const s = mote.size * k;
      ctx.globalAlpha = k * 0.85;
      ctx.drawImage(sprite, mote.x - s / 2, mote.y - s / 2, s, s);
    }

    if (this.settling && this.active) {
      for (const orb of this.orbiters) {
        orb.angle += orb.speed * orb.dir * dtSec;
        const ox = this.x + Math.cos(orb.angle) * orb.radius;
        const oy = this.y + Math.sin(orb.angle) * orb.radius * 0.72;
        const sprite = this.spriteFor(uiTheme.current().accent.a);
        ctx.globalAlpha = 0.4 + Math.sin(orb.angle * 2) * 0.15;
        ctx.drawImage(sprite, ox - orb.size / 2, oy - orb.size / 2, orb.size, orb.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  private spriteFor(color: string): HTMLCanvasElement {
    const cached = this.sprites.get(color);
    if (cached !== undefined) return cached;
    const size = this.spriteSize;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (ctx !== null) {
      const r = size / 2;
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.24, 'rgba(255,255,255,1)');
      g.addColorStop(0.62, 'rgba(255,255,255,0.42)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
    }
    this.sprites.set(color, c);
    return c;
  }

  private onMove = (e: PointerEvent): void => {
    if (!fx.lantern) return;
    this.seen = true;
    this.x = e.clientX;
    this.y = e.clientY;
    this.moveTarget = e.target instanceof Element ? e.target : null;
    this.wake();
    this.ensureLoop();
  };

  private onDown = (): void => {
    if (!fx.lantern) return;
    this.down = true;
    this.recompute();
  };

  private onUp = (): void => {
    if (!fx.lantern) return;
    this.down = false;
    this.recompute();
  };

  private onBlur = (): void => {
    this.focused = false;
    this.recompute();
  };

  private onEnter = (): void => {
    if (!fx.lantern) return;
    this.focused = true;
    this.wake();
    this.recompute();
  };

  private onLeave = (): void => {
    this.focused = false;
    this.recompute();
  };

  private onResize = (): void => {
    if (this.canvas === null || this.ctx === null) return;
    const dpr = window.devicePixelRatio || 1;
    this.spriteSize = Math.ceil(SPRITE_SIZE * dpr);
    this.sprites.clear();
    this.canvas.width = Math.ceil(window.innerWidth * dpr);
    this.canvas.height = Math.ceil(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
}

export const lantern = new LanternService();

export function initLantern(): void {
  lantern.init();
}
