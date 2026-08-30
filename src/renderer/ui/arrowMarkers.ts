import { songAccentHsl, hslToRgb } from '../core/lantern';
import arrowUrl from '../assets/arrow.png';

let base: HTMLImageElement | null = null;
let crop: HTMLCanvasElement | null = null;
let quietTimer = 0;

function scheduleRetint(): void {
  window.clearTimeout(quietTimer);
  quietTimer = window.setTimeout(retint, 250);
}

function buildCrop(): void {
  if (base === null) return;
  const natW = base.naturalWidth;
  const natH = base.naturalHeight;
  if (natW === 0 || natH === 0) return;
  const c = document.createElement('canvas');
  c.width = natW;
  c.height = natH;
  const g = c.getContext('2d');
  if (g === null) return;
  g.drawImage(base, 0, 0, natW, natH);
  const frame = g.getImageData(0, 0, natW, natH);
  const d = frame.data;
  const opaqueBlackBg = (d[3] ?? 0) > 200 && (d[0] ?? 0) + (d[1] ?? 0) + (d[2] ?? 0) < 60;
  let x0 = natW;
  let y0 = natH;
  let x1 = 0;
  let y1 = 0;
  let any = false;
  for (let i = 0; i < d.length; i += 4) {
    let a = d[i + 3] ?? 0;
    if (opaqueBlackBg) {
      a = Math.max(d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0);
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = a;
    }
    if (a < 8) {
      d[i + 3] = 0;
      continue;
    }
    any = true;
    const px = (i / 4) % natW;
    const py = Math.floor(i / 4 / natW);
    if (px < x0) x0 = px;
    if (py < y0) y0 = py;
    if (px > x1) x1 = px;
    if (py > y1) y1 = py;
  }
  if (!any) return;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  const og = out.getContext('2d');
  if (og === null) return;
  og.putImageData(frame, -x0, -y0);
  crop = out;
}

function drawScaled(source: HTMLCanvasElement, tw: number, th: number): HTMLCanvasElement {
  let cw = source.width;
  let ch = source.height;
  let current: HTMLCanvasElement = source;
  while (cw / 2 > tw && ch / 2 > th) {
    cw = Math.max(tw, Math.floor(cw / 2));
    ch = Math.max(th, Math.floor(ch / 2));
    const step = document.createElement('canvas');
    step.width = cw;
    step.height = ch;
    const sg = step.getContext('2d');
    if (sg === null) break;
    sg.imageSmoothingEnabled = true;
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(current, 0, 0, cw, ch);
    current = step;
  }
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  const g = c.getContext('2d');
  if (g !== null) {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(current, 0, 0, tw, th);
  }
  return c;
}

function retint(): void {
  if (crop === null) return;
  const ratio = window.devicePixelRatio || 1;
  const h = Math.round(64 * ratio);
  const w = Math.max(1, Math.round(h * (crop.width / crop.height)));
  const c = drawScaled(crop, w, h);
  const g = c.getContext('2d');
  if (g === null) return;
  const frame = g.getImageData(0, 0, w, h);
  const d = frame.data;
  const [ah, as] = songAccentHsl();
  const sat = Math.min(1, as * 1.1);
  const [cr, cg, cb] = hslToRgb(ah, sat, 0.62);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    d[i] = cr;
    d[i + 1] = cg;
    d[i + 2] = cb;
  }
  g.putImageData(frame, 0, 0);
  document.documentElement.style.setProperty('--arrow-marker', `url(${c.toDataURL('image/png')})`);
  document.documentElement.style.setProperty('--arrow-aspect', (crop.width / crop.height).toFixed(4));
}

export function initArrowMarkers(): void {
  if (base !== null || quietTimer !== 0) return;
  const img = new Image();
  img.onload = () => {
    base = img;
    buildCrop();
    retint();
  };
  img.src = arrowUrl;
  new MutationObserver(scheduleRetint).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', scheduleRetint);
}
