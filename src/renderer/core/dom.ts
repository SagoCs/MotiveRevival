import { fallbackPalette } from './palette';

export function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined && className !== '') node.className = className;
  return node;
}

export interface ArtImageOptions {
  fallbackUrl?: string;
}

export function createArtImage(url: string, opts: ArtImageOptions = {}): HTMLImageElement {
  const img = document.createElement('img');
  img.decoding = 'async';
  img.loading = 'lazy';
  img.alt = '';
  img.width = 128;
  img.height = 128;
  img.src = url;
  img.style.opacity = '0';
  img.addEventListener('load', () => {
    img.style.opacity = '1';
  });
  const fallbackUrl = opts.fallbackUrl;
  if (fallbackUrl !== undefined) {
    let swapped = false;
    img.addEventListener('error', () => {
      if (swapped || img.src === fallbackUrl) return;
      swapped = true;
      img.src = fallbackUrl;
    });
  }
  return img;
}

export function thumbOf(artFile: string): string {
  const idx = Math.max(artFile.lastIndexOf('/'), artFile.lastIndexOf('\\'));
  const sep = idx >= 0 ? artFile[idx] : '/';
  const base = idx >= 0 ? artFile.slice(idx + 1) : artFile;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return `${idx >= 0 ? artFile.slice(0, idx) : ''}${sep}thumbs${sep}${stem}.jpg`;
}

export function paletteBedOf(palette: readonly string[] | null, seed: string): string {
  const tones = palette !== null && palette.length > 0 ? palette : fallbackPalette(seed);
  const a = tones[0] ?? '#7c74e0';
  const b = tones[1] ?? a;
  return `linear-gradient(150deg, ${a}, ${b})`;
}

export function fatal(message: string): void {
  const banner = document.getElementById('fatal-banner');
  if (!banner) return;
  banner.textContent = message;
  banner.hidden = false;
}
