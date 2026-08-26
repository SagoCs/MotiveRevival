import { addVizTarget } from '../core/audioBands';

const BARS = 48;
const ATTACK = 0.55;
const DECAY = 0.22;
const TILT_BOOST = 0.9;
const HIGH_CUT = 0.75;

export class Viz {
  private readonly ctx2d: CanvasRenderingContext2D | null;
  private readonly heights: number[] = new Array(BARS).fill(0);
  private colorA = '#8f97e8';
  private colorB = '#6ee7d8';
  private lastColorFetch = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly themeSource: HTMLElement = document.documentElement,
  ) {
    this.ctx2d = canvas.getContext('2d');
    addVizTarget((wave) => this.draw(wave));
  }

  private refreshColors(): void {
    const now = performance.now();
    if (now - this.lastColorFetch < 400) return;
    this.lastColorFetch = now;
    const styles = getComputedStyle(this.themeSource);
    const a = styles.getPropertyValue('--p2').trim();
    const b = styles.getPropertyValue('--p3').trim();
    if (a !== '') this.colorA = a;
    if (b !== '') this.colorB = b;
  }

  private draw(wave: Uint8Array | null): void {
    const canvas = this.canvas;
    if (canvas.offsetParent === null) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = this.ctx2d;
    if (g === null) return;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    this.refreshColors();
    const grad = g.createLinearGradient(0, h, w, 0);
    grad.addColorStop(0, this.colorA);
    grad.addColorStop(1, this.colorB);
    g.fillStyle = grad;

    const gap = 3;
    const barW = (w - gap * (BARS - 1)) / BARS;
    const usable = wave !== null ? Math.floor(wave.length * HIGH_CUT) : 0;

    for (let i = 0; i < BARS; i++) {
      let target = 0;
      if (wave !== null && usable > 0) {
        const f0 = Math.pow(i / BARS, 2);
        const f1 = Math.pow((i + 1) / BARS, 2);
        const t0 = Math.floor(f0 * usable);
        const t1 = Math.max(t0 + 1, Math.floor(f1 * usable));
        let peak = 0;
        for (let k = t0; k < t1 && k < wave.length; k++) {
          const v = wave[k] ?? 0;
          if (v > peak) peak = v;
        }
        const gain = 1 + (i / BARS) * TILT_BOOST;
        target = Math.min(1, ((peak / 255) * gain) ** 1.35);
      }

      const prev = this.heights[i] ?? 0;
      const rate = target > prev ? ATTACK : DECAY;
      const next = prev + (target - prev) * rate;
      this.heights[i] = next;

      const barH = Math.max(1.5, next * h);
      const x = i * (barW + gap);
      g.globalAlpha = 0.32 + next * 0.68;
      g.beginPath();
      g.roundRect(x, h - barH, barW, barH, Math.min(barW / 2, 3));
      g.fill();
    }
    g.globalAlpha = 1;
  }
}
