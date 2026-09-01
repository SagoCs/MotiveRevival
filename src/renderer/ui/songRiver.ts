import { libraryStore } from '../core/libraryStore';
import { mediaUrl, player } from '../core/player';
import { createArtImage } from '../core/dom';
import type { IndexedTrack } from '../../shared/types';

const SLAB_COUNT = 21;
const GAP = 272;
const SPAN = SLAB_COUNT * GAP;
const HALF = SPAN / 2;
const BEZEL_H = 52;
const TIMELINE_H = 62;

const FAKE_TITLES = [
  'Winterlight Vow', 'Gossamer Meridian', 'Aurelian Skies', 'Pale Commotion',
  'Northfold Choir', 'Ivory Descent', 'Hollow Lantern', 'Ember Verdict',
  'Silken Meridian', 'The Quiet Shore', 'Lantern Thesis', 'Cinder Waltz',
];
const FAKE_ARTISTS = ['Aurelian Skies', 'Northfold Choir', 'The Quiet Shore'];

interface Slab {
  el: HTMLDivElement;
  front: HTMLDivElement;
  faces: HTMLDivElement[];
  title: HTMLSpanElement;
  artist: HTMLSpanElement;
  art: HTMLDivElement;
  slot: number;
  song: number;
  d: number | null;
  lastY: number;
  lastScale: number;
  lastTilt: number;
  lastOpacity: number;
  lastZ: number;
}

let tracks: IndexedTrack[] = [];
let slabs: Slab[] = [];
let river: HTMLDivElement | null = null;
let readout: HTMLDivElement | null = null;
let on = false;
let raf = 0;
let last = 0;
let offset = 0;
let velocity = 0;
let gliding = false;
let glideFrom = 0;
let glideDelta = 0;
let glideStart = 0;
let nextForward = 1;
let nextBackward = -1;
let committed: Slab | null = null;
let tiltMax = 26;
let curveAmt = 0.55;
let fadeAmt = 1;
let fall = 420;
const ring: number[] = [];
let readoutAt = 0;

const mod = (a: number, n: number): number => ((a % n) + n) % n;
const wrapSpan = (x: number): number => mod(x, SPAN);
const wrapHalf = (x: number): number => mod(x + HALF, SPAN) - HALF;

const wake = (): void => {
  if (!on || raf !== 0) return;
  last = 0;
  raf = window.requestAnimationFrame(step);
};

const measure = (): void => {
  if (river === null) return;
  const h = window.innerHeight;
  const topEdge = BEZEL_H;
  const bottomEdge = h - TIMELINE_H;
  const centerY = (topEdge + bottomEdge) / 2;
  fall = Math.max(260, (bottomEdge - topEdge) / 2);
  river.style.setProperty('--river-cy', `${Math.round(centerY)}px`);
};

const rebind = (slab: Slab, song: number): void => {
  slab.song = song;
  const track = tracks.length > 0 ? tracks[mod(song, tracks.length)] : undefined;
  if (track !== undefined) {
    slab.title.textContent = track.title;
    slab.artist.textContent = track.artist ?? 'Unknown Artist';
    slab.art.replaceChildren();
    const art = track.artFile;
    if (art !== null) {
      slab.art.append(createArtImage(mediaUrl(art), { fallbackUrl: mediaUrl(art) }));
    }
  } else {
    slab.title.textContent = FAKE_TITLES[mod(song, FAKE_TITLES.length)] ?? 'Untitled';
    slab.artist.textContent = FAKE_ARTISTS[mod(song, FAKE_ARTISTS.length)] ?? '';
    slab.art.replaceChildren();
  }
  slab.d = null;
  slab.lastY = NaN;
  slab.lastScale = NaN;
  slab.lastTilt = NaN;
  slab.lastOpacity = NaN;
  slab.lastZ = -1;
};

const layout = (): void => {
  for (const slab of slabs) {
    const d = wrapHalf(slab.slot * GAP - offset);
    if (slab.d !== null) {
      if (slab.d - d > HALF) {
        rebind(slab, nextBackward);
        nextBackward -= 1;
      } else if (d - slab.d > HALF) {
        rebind(slab, nextForward);
        nextForward += 1;
      }
    }
    slab.d = d;
    const n = Math.min(1, Math.abs(d) / fall);
    const nc = n * n * n;
    const y = Math.round(d);
    const scale = Math.round((1 - curveAmt * nc) * 100) / 100;
    const tilt = Math.round(-Math.sign(d) * tiltMax * nc);
    const opacity = Math.round((1 - fadeAmt * nc) * 50) / 50;
    const z = Math.round((1 - n) * 60);
    if (slab.lastY !== y || slab.lastScale !== scale || slab.lastTilt !== tilt) {
      slab.lastY = y;
      slab.lastScale = scale;
      slab.lastTilt = tilt;
      slab.el.style.transform = `translate3d(0, ${y}px, 0) rotateX(${tilt}deg) scale(${scale})`;
    }
    if (slab.lastOpacity !== opacity) {
      slab.lastOpacity = opacity;
      for (const face of slab.faces) face.style.opacity = String(opacity);
    }
    if (slab.lastZ !== z) {
      slab.lastZ = z;
      slab.el.style.zIndex = String(z);
    }
  }
};

const currentCenter = (): number => {
  const cur = player.currentTrack;
  if (cur !== null && tracks.length > 0) {
    const idx = tracks.findIndex((t) => t.absPath === cur.absPath);
    if (idx >= 0) return idx;
  }
  return 0;
};

const arrangeAround = (center: number): void => {
  offset = 0;
  velocity = 0;
  gliding = false;
  if (committed !== null) committed.el.classList.remove('committed');
  committed = null;
  let maxBelow = 0;
  for (const slab of slabs) {
    const d0 = wrapHalf(slab.slot * GAP);
    rebind(slab, center + Math.round(d0 / GAP));
    if (d0 > maxBelow) maxBelow = d0;
  }
  const k = Math.round(maxBelow / GAP);
  nextForward = center + k + 1;
  nextBackward = center - k - 1;
  const cur = player.currentTrack;
  const known = cur !== null && tracks.some((t) => t.absPath === cur.absPath);
  const home = slabs[0];
  if (known && home !== undefined) {
    home.el.classList.add('committed');
    committed = home;
  }
  layout();
};

const glideToCenter = (slab: Slab): void => {
  const raw = wrapSpan(slab.slot * GAP - offset);
  glideDelta = raw > HALF ? raw - SPAN : raw;
  glideFrom = offset;
  glideStart = performance.now();
  gliding = true;
  velocity = 0;
  wake();
};

const onFrontClick = (slab: Slab): void => {
  if (committed !== null && committed !== slab) committed.el.classList.remove('committed');
  slab.el.classList.add('committed');
  committed = slab;
  if (tracks.length > 0) player.setContext(tracks, mod(slab.song, tracks.length));
  glideToCenter(slab);
  wake();
};

const step = (ts: number): void => {
  raf = 0;
  const dtMs = last === 0 ? 16 : Math.min(50, ts - last);
  last = ts;
  const dt = dtMs / 1000;
  if (gliding) {
    const t = Math.min(1, (ts - glideStart) / 700);
    offset = wrapSpan(glideFrom + glideDelta * (1 - Math.pow(1 - t, 4)));
    if (t >= 1) {
      gliding = false;
      velocity = 0;
    }
  } else if (velocity !== 0) {
    velocity *= Math.exp(-4.4 * dt);
    if (Math.abs(velocity) < 6) velocity = 0;
    offset = wrapSpan(offset + velocity * dt);
  }
  layout();
  ring.push(dtMs);
  if (ring.length > 60) ring.shift();
  if (ts - readoutAt > 250 && readout !== null) {
    readoutAt = ts;
    let sum = 0;
    let worst = 0;
    for (const dMs of ring) {
      sum += dMs;
      if (dMs > worst) worst = dMs;
    }
    const fps = ring.length > 0 ? (1000 / (sum / ring.length)).toFixed(1) : '0.0';
    readout.textContent = `${fps} fps · worst ${worst.toFixed(1)} ms · ${tracks.length} tracks\n↑↓ tilt ${tiltMax}° · ←→ fade ${fadeAmt.toFixed(2)} · shift+↑↓ depth ${curveAmt.toFixed(2)}`;
  }
  if (gliding || velocity !== 0) raf = window.requestAnimationFrame(step);
  else last = 0;
};

const setVisible = (next: boolean): void => {
  if (on === next) return;
  on = next;
  if (river === null) return;
  river.classList.toggle('on', on);
  document.body.classList.toggle('song-river-active', on);
  if (on) {
    measure();
    arrangeAround(currentCenter());
    wake();
  } else {
    window.cancelAnimationFrame(raf);
    raf = 0;
    velocity = 0;
    gliding = false;
    last = 0;
  }
};

export const songRiver = {
  setVisible(next: boolean): void {
    if (river === null) return;
    setVisible(next);
  },
};

function buildSlab(slot: number): Slab {
  const el = document.createElement('div');
  el.className = 'river-slab';
  const front = document.createElement('div');
  front.className = 'river-front';
  const art = document.createElement('div');
  art.className = 'river-art';
  const veil = document.createElement('div');
  veil.className = 'river-veil';
  const text = document.createElement('div');
  text.className = 'river-text';
  const title = document.createElement('span');
  title.className = 'river-title';
  const artist = document.createElement('span');
  artist.className = 'river-artist';
  text.append(title, artist);
  front.append(art, veil, text);
  const top = document.createElement('div');
  top.className = 'river-edge river-edge-top';
  const bottom = document.createElement('div');
  bottom.className = 'river-edge river-edge-bottom';
  el.append(front, top, bottom);
  const slab: Slab = {
    el,
    front,
    faces: [front, top, bottom],
    title,
    artist,
    art,
    slot,
    song: 0,
    d: null,
    lastY: NaN,
    lastScale: NaN,
    lastTilt: NaN,
    lastOpacity: NaN,
    lastZ: -1,
  };
  front.addEventListener('click', () => onFrontClick(slab));
  return slab;
}

export function initSongRiver(): void {
  const pull = (): void => {
    const result = libraryStore.result;
    if (result !== null && result.ok) tracks = result.tracks;
  };
  pull();

  river = document.createElement('div');
  river.id = 'song-river';
  for (let i = 0; i < SLAB_COUNT; i++) slabs.push(buildSlab(i));
  readout = document.createElement('div');
  readout.className = 'spike-readout';
  readout.textContent =
    'wheel scrolls · click plays and centers\n↑↓ tilt · ←→ fade · shift+↑↓ depth';
  river.append(...slabs.map((s) => s.el), readout);
  document.body.append(river);

  libraryStore.onChange((result) => {
    if (result.ok) {
      tracks = result.tracks;
      if (on) arrangeAround(currentCenter());
    }
  });

  river.addEventListener(
    'wheel',
    (event) => {
      if (!on) return;
      event.preventDefault();
      gliding = false;
      velocity = Math.max(-9500, Math.min(9500, velocity - event.deltaY * 4.5));
      wake();
    },
    { passive: false },
  );

  window.addEventListener('resize', () => {
    measure();
    layout();
    wake();
  });

  window.addEventListener('keydown', (event) => {
    if (!on) return;
    const target = event.target as HTMLElement | null;
    if (
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    let used = true;
    if (event.key === 'ArrowUp') tiltMax = Math.min(48, tiltMax + 2);
    else if (event.key === 'ArrowDown') tiltMax = Math.max(0, tiltMax - 2);
    else if (event.key === 'ArrowLeft') fadeAmt = Math.min(1, fadeAmt + 0.05);
    else if (event.key === 'ArrowRight') fadeAmt = Math.max(0, fadeAmt - 0.05);
    else if (event.shiftKey && event.key === 'ArrowUp') curveAmt = Math.min(0.8, curveAmt + 0.05);
    else if (event.shiftKey && event.key === 'ArrowDown') curveAmt = Math.max(0, curveAmt - 0.05);
    else used = false;
    if (!used) return;
    event.preventDefault();
    wake();
  });

  measure();
}
