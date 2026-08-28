import { fx } from '../core/fx';

const FRICTION_PER_FRAME = 0.915;
const WHEEL_GAIN = 0.34;
const VEL_CAP = 130;
const DRAG_THRESHOLD_PX = 6;
const EDGE_RESISTANCE = 0.32;
const EDGE_PULLBACK = 0.16;
const CENTER_COMPRESS_MAX = 0.05;
const SPEED_SQUEEZE_MAX = 0.03;
const BUSY_VELOCITY = 8;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export class Carousel {
  private readonly host: HTMLElement;
  private readonly content: HTMLElement;

  private pos = 0;
  private vel = 0;
  private maxScroll = 0;

  private rafId = 0;
  private centers: Array<{ el: HTMLElement; center: number; lastCs: string | null; lastPy: string | null }> = [];

  private pointerId: number | null = null;
  private dragStartY = 0;
  private dragStartPos = 0;
  private moved = false;
  private suppressClickUntil = 0;
  private samples: Array<{ y: number; t: number }> = [];
  private frameFlip = false;
  private centersStartHint = 0;
  private measureQueued = false;
  private lastEmittedPos = -1;
  private moveCb: ((pos: number, height: number) => void) | null = null;

  private readonly resizeObserver: ResizeObserver;

  constructor(host: HTMLElement, content: HTMLElement) {
    this.host = host;
    this.content = content;

    host.addEventListener('wheel', this.onWheel, { passive: false });
    host.addEventListener('pointerdown', this.onPointerDown);
    host.addEventListener('pointermove', this.onPointerMove);
    host.addEventListener('pointerup', this.onPointerUp);
    host.addEventListener('pointercancel', this.onPointerUp);

    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(host);

    this.running = true;
    this.rafId = requestAnimationFrame(this.tick);
  }

  setContent(fragment: DocumentFragment): void {
    this.pos = 0;
    this.vel = 0;
    this.centers = [];
    this.lastEmittedPos = -1;
    this.content.replaceChildren(fragment);
    this.content.style.transform = 'translate3d(0,0,0)';
    requestAnimationFrame(() => {
      this.measure();
      this.paint();
    });
  }

  wasDrag(): boolean {
    return Date.now() < this.suppressClickUntil;
  }

  busy(): boolean {
    return this.pointerId !== null || Math.abs(this.vel) > BUSY_VELOCITY;
  }

  getPos(): number {
    return this.pos;
  }

  viewHeight(): number {
    return this.host.clientHeight;
  }

  onViewportMove(cb: (pos: number, height: number) => void): void {
    this.moveCb = cb;
  }

  windowContent(): HTMLElement {
    return this.content;
  }

  refresh(): void {
    this.measure();
    this.paint();
  }

  appendNodes(fragment: DocumentFragment): void {
    this.content.append(fragment);
    if (this.measureQueued) return;
    this.measureQueued = true;
    requestAnimationFrame(() => {
      this.measureQueued = false;
      this.measure();
      this.paint();
    });
  }

  enterStagger(): void {
    if (!fx.motion || !fx.carousel) return;
    const c = this.content;
    c.classList.remove('swap-enter');
    void c.offsetWidth;
    c.classList.add('swap-enter');
    window.setTimeout(() => c.classList.remove('swap-enter'), 900);
  }

  bandChildren(bandPadRows = 2): HTMLElement[] {
    const h = this.host.clientHeight;
    if (h <= 0) return [];
    const lo = this.pos - bandPadRows * 96 - 40;
    const hi = this.pos + h + bandPadRows * 96;
    const out: HTMLElement[] = [];
    const kids = this.content.children;
    for (let i = 0; i < kids.length; i++) {
      const node = kids[i] as HTMLElement;
      const top = node.offsetTop;
      if (top > hi) break;
      if (top + node.offsetHeight < lo) continue;
      out.push(node);
      if (out.length >= 90) break;
    }
    return out;
  }

  firstInteractive(): HTMLElement | null {
    return this.content.querySelector<HTMLElement>('[data-interactive]');
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
  }

  private measure(): void {
    this.maxScroll = Math.max(0, this.content.scrollHeight - this.host.clientHeight);
    this.centers = [];
    for (const child of Array.from(this.content.children)) {
      const el = child as HTMLElement;
      this.centers.push({ el, center: el.offsetTop + el.offsetHeight / 2, lastCs: null, lastPy: null });
    }
    this.centersStartHint = 0;
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= this.host.clientHeight;
    this.vel = clamp(this.vel + dy * WHEEL_GAIN, -VEL_CAP, VEL_CAP);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!e.isPrimary || e.button !== 0) return;
    this.pointerId = e.pointerId;
    this.dragStartY = e.clientY;
    this.dragStartPos = this.pos;
    this.moved = false;
    this.vel = 0;
    this.samples = [{ y: e.clientY, t: performance.now() }];
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.pointerId !== e.pointerId) return;
    const delta = e.clientY - this.dragStartY;
    if (!this.moved && Math.abs(delta) > DRAG_THRESHOLD_PX) {
      this.moved = true;
      try {
        this.host.setPointerCapture(e.pointerId);
      } catch {
        return;
      }
    }

    let next = this.dragStartPos - delta;
    if (next < 0) next *= EDGE_RESISTANCE;
    else if (next > this.maxScroll) next = this.maxScroll + (next - this.maxScroll) * EDGE_RESISTANCE;
    this.pos = next;

    this.samples.push({ y: e.clientY, t: performance.now() });
    if (this.samples.length > 6) this.samples.shift();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.pointerId !== e.pointerId) return;
    this.pointerId = null;
    if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);

    if (this.moved) {
      this.suppressClickUntil = Date.now() + 120;
      if (this.samples.length >= 2) {
        const a = this.samples[0];
        const b = this.samples[this.samples.length - 1];
        if (a !== undefined && b !== undefined && b.t > a.t) {
          const pxPerMs = (a.y - b.y) / (b.t - a.t);
          this.vel = clamp(pxPerMs * 16, -VEL_CAP, VEL_CAP);
        }
      }
    }
    this.samples = [];
  };

  private running = true;

  private tick = (): void => {
    if (!this.running) return;

    if (this.pointerId === null) {
      this.pos += this.vel;
      this.vel *= FRICTION_PER_FRAME;
      if (Math.abs(this.vel) < 0.08) this.vel = 0;

      if (this.pos < 0) {
        this.pos += -this.pos * EDGE_PULLBACK;
        this.vel *= 0.7;
        if (this.pos > -0.4) this.pos = 0;
      } else if (this.pos > this.maxScroll) {
        this.pos += (this.maxScroll - this.pos) * EDGE_PULLBACK;
        this.vel *= 0.7;
        if (this.pos - this.maxScroll < 0.4) this.pos = this.maxScroll;
      }
    }

    this.paint();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private paint(): void {
    this.content.style.transform = `translate3d(0, ${-this.pos.toFixed(2)}px, 0)`;

    if (this.moveCb !== null && Math.abs(this.pos - this.lastEmittedPos) > 2) {
      this.lastEmittedPos = this.pos;
      this.moveCb(this.pos, this.host.clientHeight);
    }

    if (!fx.motion || !fx.carousel) return;

    const hostH = this.host.clientHeight;
    if (hostH === 0) return;

    this.frameFlip = !this.frameFlip;
    const moving = Math.abs(this.vel) > 0.6;

    if (this.frameFlip && !moving) return;

    const viewCenter = this.pos + hostH / 2;
    const halfWindow = hostH / 2 + 120;
    const loBound = viewCenter - halfWindow;
    const hiBound = viewCenter + halfWindow;
    const squeeze = 1 - Math.min(Math.abs(this.vel) / VEL_CAP, 1) * SPEED_SQUEEZE_MAX;
    const velN = clamp(this.vel / VEL_CAP, -1, 1);

    let idx = this.centersStartHint;
    if (idx >= this.centers.length) idx = Math.max(0, this.centers.length - 1);
    while (idx > 0 && (this.centers[idx]?.center ?? Number.POSITIVE_INFINITY) > loBound) idx -= 1;
    while (
      idx < this.centers.length - 1 &&
      (this.centers[idx + 1]?.center ?? Number.NEGATIVE_INFINITY) <= loBound
    ) {
      idx += 1;
    }
    this.centersStartHint = idx;

    for (; idx < this.centers.length; idx++) {
      const entry = this.centers[idx];
      if (entry === undefined) continue;
      if (entry.center > hiBound) break;
      const dist = entry.center - viewCenter;
      const t = Math.min(Math.abs(dist) / (hostH / 2), 1);
      const cs = ((1 - t * CENTER_COMPRESS_MAX) * squeeze).toFixed(2);
      let py = '0px';
      if (moving) {
        const dirFactor = clamp(dist / (hostH / 2), -1.5, 1.5);
        const lag = -velN * 14 * dirFactor;
        const spread = Math.abs(velN) * 26 * dirFactor;
        py = `${Math.round(lag + spread)}px`;
      }
      if (cs !== entry.lastCs) {
        entry.lastCs = cs;
        entry.el.style.setProperty('--cs', cs);
      }
      if (py !== entry.lastPy) {
        entry.lastPy = py;
        entry.el.style.setProperty('--py', py);
      }
    }
  }
}
