import { libraryStore } from '../core/libraryStore';
import { mediaUrl, player } from '../core/player';
import { createArtImage } from '../core/dom';
import { appBus } from '../core/appBus';
import { playlistsStore } from '../core/playlistsStore';
import { lantern } from '../core/lantern';
import { deriveAccent } from '../core/palette';
import { openNowPlaying } from './overlay';
import type { IndexedTrack } from '../../shared/types';

const SLAB_COUNT = 21;
const GAP = 145;
const BEZEL_H = 52;
const TIMELINE_H = 62;
const EDGE_MARGIN = 70;
const SWIPE_T = 140;
const DRAG_MAX = 220;
const DRAG_DEAD = 8;

interface Slab {
  el: HTMLDivElement;
  title: HTMLSpanElement;
  artist: HTMLSpanElement;
  art: HTMLDivElement;
  slot: number;
  song: number;
  trackPath: string | null;
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
let on = false;
let raf = 0;
let last = 0;
let position = 0;
let basePosition = 0;
let velocity = 0;
let gliding = false;
let glideFrom = 0;
let glideDelta = 0;
let glideStart = 0;
let glideDuration = 700;
let committed: Slab | null = null;
let committedPath: string | null = null;
let riverOriginated = false;
let glowR: HTMLDivElement | null = null;
let glowL: HTMLDivElement | null = null;
let promptR: HTMLDivElement | null = null;
let promptL: HTMLDivElement | null = null;
let namesPanel: HTMLDivElement | null = null;
let namesList: HTMLDivElement | null = null;
let namesTrack: IndexedTrack | null = null;
let dragSuppress = false;
let lastSwipeRelease = 0;
const addedTimers = new Map<HTMLDivElement, number>();
const swipeQueued = new Set<string>();
const tiltMax = 38;
const curveAmt = 0.55;
const fadeAmt = 1;
let fall = 420;
let fadeRange = 350;
let riverCy = 0;
let fitScale = 1;

const mod = (a: number, n: number): number => ((a % n) + n) % n;
const slotOffset = (slot: number): number => (slot <= Math.floor(SLAB_COUNT / 2) ? slot : slot - SLAB_COUNT);

const resetSlabs = (base: number): void => {
  for (let i = 0; i < slabs.length; i++) {
    const slab = slabs[i];
    if (slab === undefined) continue;
    slab.slot = slotOffset(i);
    rebind(slab, base + slab.slot);
  }
};

const rotateSlabs = (direction: 1 | -1): void => {
  basePosition += direction;
  const edge = direction > 0 ? -Math.floor(SLAB_COUNT / 2) : Math.floor(SLAB_COUNT / 2);
  const incoming = slabs.find((slab) => slab.slot === edge);
  if (incoming === undefined) return;
  for (const slab of slabs) slab.slot -= direction;
  incoming.slot = direction > 0 ? Math.floor(SLAB_COUNT / 2) : -Math.floor(SLAB_COUNT / 2);
  rebind(incoming, basePosition + incoming.slot);
};

const diluteColor = (color: string): string => `color-mix(in srgb, ${color} 45%, white)`;

const wake = (): void => {
  if (!on || raf !== 0) return;
  last = 0;
  raf = window.requestAnimationFrame(step);
};

const measure = (): void => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const topEdge = BEZEL_H;
  const bottomEdge = h - TIMELINE_H;
  riverCy = (topEdge + bottomEdge) / 2;
  fall = Math.max(300, (bottomEdge - topEdge) / 2);
  fadeRange = Math.max(240, fall - EDGE_MARGIN);
  fitScale = Math.max(0.7, Math.min(1, Math.min(w / 1200, h / 780)));
  const glowH = Math.round(Math.max(300, Math.min(640, fadeRange * 1.05)));
  document.body.style.setProperty('--river-cy', `${Math.round(riverCy)}px`);
  document.body.style.setProperty('--river-gh', `${glowH}px`);
};

const rebind = (slab: Slab, song: number): void => {
  slab.song = song;
  const track = tracks.length > 0 ? tracks[mod(song, tracks.length)] : undefined;
  slab.trackPath = track?.absPath ?? null;
  if (track !== undefined) {
    slab.title.textContent = track.title;
    slab.artist.textContent = track.artist ?? 'Unknown Artist';
    slab.art.replaceChildren();
    const art = track.artFile;
    if (art !== null) {
      const img = createArtImage(mediaUrl(art), { fallbackUrl: mediaUrl(art) });
      img.decoding = 'async';
      slab.art.append(img);
    }
  } else {
    slab.title.textContent = '';
    slab.artist.textContent = '';
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
  if (tracks.length === 0) return;
  const base = Math.floor(position);
  while (basePosition < base) rotateSlabs(1);
  while (basePosition > base) rotateSlabs(-1);
  const fraction = position - basePosition;
  for (const slab of slabs) {
    const localOffset = slotOffset(slab.slot);
    const d = (localOffset - fraction) * GAP;
    slab.d = d;
  }
  if (committedPath !== null) {
    committed = null;
    for (const slab of slabs) {
      const isCommitted = slab.trackPath === committedPath;
      slab.el.classList.toggle('committed', isCommitted);
      if (isCommitted) committed = slab;
    }
  }
  for (const slab of slabs) {
    const d = slab.d ?? 0;
    const n = Math.min(1, Math.abs(d) / fadeRange);
    const nS = n * n;
    const nT = Math.pow(n, 1.5);
    const y = Math.round(d * 2) / 2;
    const scale =
      Math.round((1 - curveAmt * nS) * (slab === committed ? 1.07 : 1) * fitScale * 100) / 100;
    const tilt = Math.round(-Math.sign(d) * tiltMax * nT * 10) / 10;
    const opacity = Math.round((1 - fadeAmt * nS) * 50) / 50;
    const z = Math.round((1 - n) * 60);
    if (slab.lastY !== y || slab.lastScale !== scale || slab.lastTilt !== tilt) {
      slab.lastY = y;
      slab.lastScale = scale;
      slab.lastTilt = tilt;
      slab.el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) rotateX(${tilt.toFixed(1)}deg) scale(${scale})`;
    }
    if (slab.lastOpacity !== opacity) {
      slab.lastOpacity = opacity;
      slab.el.style.opacity = String(opacity);
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
  position = center;
  basePosition = Math.floor(center);
  velocity = 0;
  gliding = false;
  if (committed !== null) committed.el.classList.remove('committed');
  committed = null;
  committedPath = null;
  resetSlabs(basePosition);
  const cur = player.currentTrack;
  const known = cur !== null && tracks.some((t) => t.absPath === cur.absPath);
  const home = slabs[0];
  if (known && home !== undefined) {
    committedPath = cur?.absPath ?? null;
    home.el.classList.add('committed');
    committed = home;
  }
  layout();
};

const glideToCenter = (slab: Slab): void => {
  glideDelta = slab.song - position;
  glideFrom = position;
  glideStart = performance.now();
  glideDuration = 700;
  gliding = true;
  velocity = 0;
  wake();
};

const glideToCurrent = (): void => {
  const current = player.currentTrack;
  if (current === null || tracks.length === 0) return;
  const currentIndex = tracks.findIndex((track) => track.absPath === current.absPath);
  if (currentIndex < 0) return;
  const cycle = tracks.length;
  const cycleOffset = Math.round((position - currentIndex) / cycle);
  const targetPosition = currentIndex + cycleOffset * cycle;
  glideDelta = targetPosition - position;
  glideFrom = position;
  glideStart = performance.now();
  glideDuration = Math.max(700, Math.min(3000, Math.abs(glideDelta) / 0.9));
  gliding = true;
  velocity = 0;
  wake();
};

const onFrontClick = (slab: Slab): void => {
  if (dragSuppress) {
    dragSuppress = false;
    return;
  }
  const cur = player.currentTrack;
  const track = tracks.length > 0 ? tracks[mod(slab.song, tracks.length)] : undefined;
  if (cur !== null && track !== undefined && track.absPath === cur.absPath) {
    openNowPlaying();
  } else if (track !== undefined) {
    if (committed !== null && committed !== slab) committed.el.classList.remove('committed');
    committedPath = track.absPath;
    slab.el.classList.add('committed');
    committed = slab;
    riverOriginated = true;
    player.setContext(tracks, mod(slab.song, tracks.length));
  }
  glideToCenter(slab);
  wake();
};

const fadeGlow = (): void => {
  for (const g of [glowR, glowL, promptR, promptL]) {
    if (g !== null) g.style.opacity = '0';
  }
};

const resetPrompt = (prompt: HTMLDivElement | null, label: string): void => {
  if (prompt === null) return;
  const timer = addedTimers.get(prompt);
  if (timer !== undefined) window.clearTimeout(timer);
  addedTimers.delete(prompt);
  prompt.textContent = label;
  prompt.style.color = '';
};

const showAdded = (side: 1 | -1, track: IndexedTrack): void => {
  const prompt = side === 1 ? promptL : promptR;
  if (prompt === null) return;
  const label = side === 1 ? 'Add to queue' : 'Add to playlist';
  const accent = deriveAccent(track.palette).g;
  const timer = addedTimers.get(prompt);
  if (timer !== undefined) window.clearTimeout(timer);
  prompt.textContent = 'Added.';
  prompt.style.color = accent;
  prompt.style.opacity = '0.72';
  const next = window.setTimeout(() => {
    prompt.style.opacity = '0';
    const restore = window.setTimeout(() => resetPrompt(prompt, label), 240);
    addedTimers.set(prompt, restore);
  }, 1250);
  addedTimers.set(prompt, next);
};

const springBack = (el: HTMLDivElement, from: number): void => {
  if (from === 0) return;
  const start = performance.now();
  const tween = (ts: number): void => {
    const t = Math.min(1, (ts - start) / 380);
    const p = 1 - Math.pow(1 - t, 4);
    el.style.translate = `${(from * (1 - p)).toFixed(1)}px 0`;
    if (t < 1) window.requestAnimationFrame(tween);
    else el.style.translate = '0px 0';
  };
  window.requestAnimationFrame(tween);
};

const swipeTrackOf = (slab: Slab): IndexedTrack | undefined =>
  tracks.length > 0 ? tracks[mod(slab.song, tracks.length)] : undefined;

const onCardPointerDown = (slab: Slab, event: PointerEvent): void => {
  if (event.button !== 0 || slab !== committed) return;
  const el = slab.el;
  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;
  let x = 0;
  try {
    el.setPointerCapture(event.pointerId);
  } catch {
    return;
  }
  const cleanup = (): void => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
  };
  const onMove = (move: PointerEvent): void => {
    const dx = move.clientX - startX;
    const dy = move.clientY - startY;
    if (!dragging) {
      if (Math.abs(dx) < DRAG_DEAD && Math.abs(dy) < DRAG_DEAD) return;
      if (Math.abs(dx) <= Math.abs(dy)) {
        dragSuppress = true;
        cleanup();
        return;
      }
      dragging = true;
      closeNames();
      resetPrompt(promptR, 'Add to playlist');
      resetPrompt(promptL, 'Add to queue');
      const soft = diluteColor(deriveAccent(swipeTrackOf(slab)?.palette ?? null).g);
      if (glowR !== null) {
        glowR.style.background = soft;
      }
      if (glowL !== null) {
        glowL.style.background = soft;
      }
    }
    x = Math.max(-DRAG_MAX, Math.min(DRAG_MAX, dx));
    el.style.translate = `${x}px 0`;
    const r = Math.max(0, Math.min(1, (x - 40) / (SWIPE_T - 40))) * 0.55;
    const l = Math.max(0, Math.min(1, (-x - 40) / (SWIPE_T - 40))) * 0.55;
    if (glowR !== null) glowR.style.opacity = String(r);
    if (glowL !== null) glowL.style.opacity = String(l);
    if (promptR !== null) promptR.style.opacity = String(r);
    if (promptL !== null) promptL.style.opacity = String(l);
  };
  const onUp = (): void => {
    const wasDragging = dragging;
    cleanup();
    fadeGlow();
    if (!wasDragging) return;
    dragSuppress = true;
    lastSwipeRelease = performance.now();
    springBack(el, x);
    const track = swipeTrackOf(slab);
    if (track === undefined) return;
    if (x > SWIPE_T) {
      openNames(track);
    } else if (x < -SWIPE_T && !swipeQueued.has(track.id)) {
      swipeQueued.add(track.id);
      player.appendToQueue(track);
      showAdded(1, track);
    }
  };
  const onCancel = (): void => {
    cleanup();
    fadeGlow();
    dragSuppress = true;
    springBack(el, x);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
};

const rebuildNames = (): void => {
  if (namesList === null) return;
  namesList.replaceChildren();
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'river-name-input';
  input.placeholder = 'New playlist';
  input.spellcheck = false;
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const track = namesTrack;
    if (track === null) return;
    const name = input.value.trim() === '' ? 'New Playlist' : input.value.trim();
    void playlistsStore.create(name).then((pl) => {
      void playlistsStore.addTrack(pl.id, { trackId: track.id, absPath: track.absPath }).then(() => {
        showAdded(-1, track);
        closeNames();
      });
    });
  });
  namesList.append(input);
  for (const pl of playlistsStore.list()) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'river-name';
    const already = pl.tracks.some((t) => t.trackId === namesTrack?.id);
    item.textContent = already ? `${pl.name} — added` : pl.name;
    if (already) item.classList.add('added');
    item.addEventListener('click', () => {
      const track = namesTrack;
      if (track === null) return;
      if (already) {
        closeNames();
        return;
      }
      void playlistsStore.addTrack(pl.id, { trackId: track.id, absPath: track.absPath }).then(() => {
        showAdded(-1, track);
        closeNames();
      });
    });
    namesList.append(item);
  }
};

const openNames = (track: IndexedTrack): void => {
  namesTrack = track;
  rebuildNames();
  if (namesPanel !== null) {
    namesPanel.classList.add('open');
    namesList?.querySelector<HTMLInputElement>('input')?.focus();
  }
};

const closeNames = (): void => {
  namesTrack = null;
  if (namesPanel !== null) namesPanel.classList.remove('open');
};

const step = (ts: number): void => {
  raf = 0;
  const dtMs = last === 0 ? 16 : Math.min(50, ts - last);
  last = ts;
  const dt = dtMs / 1000;
  if (gliding) {
    const t = Math.min(1, (ts - glideStart) / glideDuration);
    position = glideFrom + glideDelta * (1 - Math.pow(1 - t, 4));
    if (t >= 1) {
      gliding = false;
      velocity = 0;
    }
  } else if (velocity !== 0) {
    velocity *= Math.exp(-3.1 * dt);
    if (Math.abs(velocity) < 5) velocity = 0;
    position += (velocity * dt) / GAP;
  }
  layout();
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
    closeNames();
    fadeGlow();
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
  el.className = 'river-card';
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
  el.append(art, veil, text);
  const slab: Slab = {
    el,
    title,
    artist,
    art,
    slot,
    song: 0,
    trackPath: null,
    d: null,
    lastY: NaN,
    lastScale: NaN,
    lastTilt: NaN,
    lastOpacity: NaN,
    lastZ: -1,
  };
  el.addEventListener('click', () => onFrontClick(slab));
  el.addEventListener('pointerdown', (event) => onCardPointerDown(slab, event));
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
  river.append(...slabs.map((s) => s.el));
  document.body.append(river);

  glowR = document.createElement('div');
  glowR.className = 'river-glow river-glow-right';
  glowL = document.createElement('div');
  glowL.className = 'river-glow river-glow-left';
  promptR = document.createElement('div');
  promptR.className = 'river-swipe-prompt right';
  promptR.textContent = 'Add to playlist';
  promptL = document.createElement('div');
  promptL.className = 'river-swipe-prompt left';
  promptL.textContent = 'Add to queue';
  document.body.append(glowR, glowL, promptR, promptL);

  namesPanel = document.createElement('div');
  namesPanel.id = 'river-names';
  namesList = document.createElement('div');
  namesList.className = 'river-names-list';
  namesPanel.append(namesList);
  document.body.append(namesPanel);

  if (!playlistsStore.ready) void playlistsStore.load();

  window.addEventListener('click', (event) => {
    if (namesTrack === null) return;
    if (performance.now() - lastSwipeRelease < 200) return;
    const target = event.target as HTMLElement | null;
    if (target !== null && target.closest('#river-names') !== null) return;
    closeNames();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && namesTrack !== null) closeNames();
  });

  libraryStore.onChange((result) => {
    if (result.ok) {
      tracks = result.tracks;
      if (on) arrangeAround(currentCenter());
    }
  });

  window.addEventListener(
    'wheel',
    (event) => {
      if (!on) return;
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        target.closest(
          '#overlay, #detail-layer, #playlist-layer, #search-oracle, #settings-modal, #sort-popover, #queue-panel, #river-names',
        ) !== null
      ) {
        return;
      }
      event.preventDefault();
      gliding = false;
      velocity = Math.max(-13000, Math.min(13000, velocity - event.deltaY * 2.8));
      wake();
    },
    { passive: false },
  );

  window.addEventListener('dblclick', (event) => {
    if (!on || player.currentTrack === null) return;
    if (event.clientY < BEZEL_H || event.clientY > window.innerHeight - TIMELINE_H) return;
    const target = event.target as HTMLElement | null;
    if (
      target !== null &&
      target.closest(
        '.river-card, #river-names, #overlay, #detail-layer, #playlist-layer, #search-oracle, #settings-modal, #sort-popover, #queue-panel',
      ) !== null
    ) {
      return;
    }
    event.preventDefault();
    glideToCurrent();
    wake();
  });

  appBus.on('track-selected', ({ track }) => {
    swipeQueued.delete(track.id);
    if (!on) return;
    if (riverOriginated) {
      riverOriginated = false;
      return;
    }
    const idx = tracks.findIndex((t) => t.absPath === track.absPath);
    if (idx >= 0) arrangeAround(idx);
  });

  window.addEventListener('resize', () => {
    measure();
    layout();
    wake();
  });

  measure();
}
