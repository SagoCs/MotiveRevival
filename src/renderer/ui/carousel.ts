const FRICTION_PER_FRAME = 0.915;
const WHEEL_GAIN = 0.34;
const VEL_CAP = 130;
const DRAG_THRESHOLD_PX = 6;
const EDGE_RESISTANCE = 0.32;
const EDGE_PULLBACK = 0.16;
const CENTER_COMPRESS_MAX = 0.05;
const SPEED_SQUEEZE_MAX = 0.03;

import { fx } from '../core/fx';

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
  private centers: Array<{ el: HTMLElement; center: number }> = [];

  private pointerId: number | null = null;
  private dragStartY = 0;
  private dragStartPos = 0;
  private moved = false;
  private suppressClickUntil = 0;
  private samples: Array<{ y: number; t: number }> = [];

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
      this.centers.push({ el, center: el.offsetTop + el.offsetHeight / 2 });
    }
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

    if (!fx.motion) return;

    const hostH = this.host.clientHeight;
    if (hostH === 0) return;
    const viewCenter = this.pos + hostH / 2;
    const halfWindow = hostH / 2 + 220;
    const squeeze = 1 - Math.min(Math.abs(this.vel) / VEL_CAP, 1) * SPEED_SQUEEZE_MAX;

    for (const { el, center } of this.centers) {
      const dist = Math.abs(center - viewCenter);
      if (dist > halfWindow) continue;
      const t = Math.min(dist / (hostH / 2), 1);
      const scale = (1 - t * CENTER_COMPRESS_MAX) * squeeze;
      el.style.setProperty('--cs', scale.toFixed(4));
    }
  }
}
