export interface RiverV2Entry {
  id: string;
  title: string;
  meta: string[];
  art: string | null;
}

export interface RiverV2Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RiverV2Layout {
  visibleCount: number;
  depth: number;
}

export interface RiverV2Handle {
  mount(region: RiverV2Region, dpr: number): void;
  setRegion(region: RiverV2Region, dpr?: number): void;
  setEntries(entries: RiverV2Entry[]): void;
  scrollTo(index: number): void;
  glideTo(index: number): void;
  scrollPosition(): number;
  setLayout(layout: Partial<RiverV2Layout>): void;
  setVisible(visible: boolean): void;
  onHome(cb: () => void): void;
  onEntryActivated(cb: (id: string) => void): void;
  setCommitted(id: string | null): void;
  entryRect(id: string): DOMRect | null;
  hideEntry(id: string): void;
  destroy(): void;
}

interface Slab {
  el: HTMLDivElement;
  id: string;
  index: number;
  hidden: boolean;
  lastY: number;
  lastScale: number;
  lastTilt: number;
  lastOpacity: number;
  lastZ: number;
}

const DEFAULT_VISIBLE_COUNT = 7;
const DEFAULT_DEPTH = 1.4;
const SLOT_USE = 0.88;
const CARD_ASPECT = 3.7;
const CARD_WIDTH_SHARE = 0.72;
const MIN_CARD_H = 56;
const MIN_PERSPECTIVE = 600;
const LENS_WIDTH = 1.2;
const LENS_STRENGTH = 0.5;
const TABLE_STEP = 0.05;
const TABLE_MAX = 16;
const WHEEL_GAIN = 2.8;
const WHEEL_MAX = 13000;
const DECAY = 3.1;
const CRAWL = 5;
const DT_MAX = 50;
const DRAG_DEAD = 8;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function createRiverV2(): RiverV2Handle {
  let root: HTMLDivElement | null = null;
  let world: HTMLDivElement | null = null;
  let voidEl: HTMLDivElement | null = null;
  let slabs: Slab[] = [];
  let region: RiverV2Region = { x: 0, y: 0, width: 0, height: 0 };
  let dpr = 1;
  let visibleCount = DEFAULT_VISIBLE_COUNT;
  let depth = DEFAULT_DEPTH;
  let pxStep = 1;
  let slotH = 100;
  let cardW = 0;
  let cardH = 0;
  let centerX = 0;
  let centerY = 0;
  let fadeRange = 100;
  let position = 0;
  let velocity = 0;
  let gliding = false;
  let glideFrom = 0;
  let glideDelta = 0;
  let glideStart = 0;
  let glideDuration = 700;
  let raf = 0;
  let last = 0;
  let shown = false;
  let suppressDbl = 0;
  let homeCb: (() => void) | null = null;
  let entryCb: ((id: string) => void) | null = null;
  let committedId: string | null = null;
  let curve = 0.75;
  let tiltMax = 52;
  let fadeHold = 0.6;
  let lensAmt = 0;
  let lensQ = 1 / (LENS_WIDTH * LENS_WIDTH);
  let depthTable: number[] = [0];

  const maxIndex = (): number => Math.max(0, slabs.length - 1);

  const anchorOf = (): number => {
    const count = slabs.length;
    if (count === 0) return 0;
    if (count <= visibleCount) return (count - 1) / 2;
    return clamp(position, 0, count - 1);
  };

  const depthAt = (dist: number): number => {
    const cover = (depthTable.length - 1) * TABLE_STEP;
    if (dist > cover) return fadeRange * 2;
    const pos = dist / TABLE_STEP;
    const idx = Math.floor(pos);
    const lastIdx = depthTable.length - 1;
    if (idx >= lastIdx) return depthTable[lastIdx] ?? 0;
    const frac = pos - idx;
    const a = depthTable[idx] ?? 0;
    const b = depthTable[idx + 1] ?? 0;
    return a + (b - a) * frac;
  };

  const layout = (): void => {
    if (world === null || slabs.length === 0) return;
    const anchor = anchorOf();
    const count = slabs.length;
    let effFade = fadeRange;
    if (count > visibleCount) {
      const shortSide = Math.min(anchor, count - 1 - anchor);
      effFade = clamp(shortSide * slotH * 0.92, slotH * 1.25, fadeRange);
    }
    const remap = fadeRange / effFade;
    const ySquash = effFade / fadeRange;
    for (const slab of slabs) {
      const dist = Math.abs(slab.index - anchor);
      const side = Math.sign(slab.index - anchor);
      const yAbs = depthAt(dist * remap);
      const yOff = yAbs * ySquash;
      const n = Math.min(1, yAbs / fadeRange);
      const scale = (1 - curve * n * n) * (1 + lensAmt * Math.exp(-dist * dist * lensQ));
      const tilt = -side * tiltMax * Math.pow(n, 1.5);
      const opacity = n <= fadeHold ? 1 : Math.max(0, 1 - Math.pow((n - fadeHold) / (1 - fadeHold), 2));
      const y = Math.round((centerY + side * yOff) / pxStep) * pxStep;
      const zIdx = Math.round((1 - n) * 60);
      if (y !== slab.lastY || scale !== slab.lastScale || tilt !== slab.lastTilt) {
        slab.lastY = y;
        slab.lastScale = scale;
        slab.lastTilt = tilt;
        slab.el.style.transform = `translate3d(0, ${y.toFixed(3)}px, 0) rotateX(${tilt.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
      }
      if (opacity !== slab.lastOpacity) {
        slab.lastOpacity = opacity;
        slab.el.style.opacity = opacity.toFixed(4);
      }
      if (zIdx !== slab.lastZ) {
        slab.lastZ = zIdx;
        slab.el.style.zIndex = String(zIdx);
      }
      slab.el.style.visibility = n >= 1 || slab.hidden ? 'hidden' : 'visible';
    }
  };

  const wake = (): void => {
    if (!shown || raf !== 0) return;
    last = 0;
    raf = window.requestAnimationFrame(step);
  };

  const step = (ts: number): void => {
    raf = 0;
    const dtMs = last === 0 ? 16 : Math.min(DT_MAX, ts - last);
    last = ts;
    const dt = dtMs / 1000;
    if (slabs.length > 0) {
      if (gliding) {
        const t = Math.min(1, (ts - glideStart) / glideDuration);
        position = glideFrom + glideDelta * (1 - Math.pow(1 - t, 4));
        if (t >= 1) {
          gliding = false;
          velocity = 0;
        }
      } else if (velocity !== 0) {
        velocity *= Math.exp(-DECAY * dt);
        if (Math.abs(velocity) < CRAWL) velocity = 0;
        position += (velocity * dt) / slotH;
      }
      const clamped = clamp(position, 0, maxIndex());
      if (clamped !== position) {
        position = clamped;
        if ((position <= 0 && velocity < 0) || (position >= maxIndex() && velocity > 0)) velocity = 0;
      }
      layout();
    }
    if (gliding || velocity !== 0) raf = window.requestAnimationFrame(step);
    else last = 0;
  };

  const derive = (): void => {
    if (root === null || world === null) return;
    curve = clamp(0.45 + 0.3 * depth, 0.2, 0.9);
    tiltMax = 30 + 22 * depth;
    fadeHold = clamp(0.35 + 0.25 * depth, 0, 0.85);
    lensAmt = (1 / SLOT_USE - 1) * LENS_STRENGTH;
    slotH = region.height / visibleCount;
    cardH = Math.max(MIN_CARD_H, Math.floor(slotH * SLOT_USE * dpr) / dpr);
    cardW = Math.min(Math.floor(region.width * CARD_WIDTH_SHARE), Math.floor(cardH * CARD_ASPECT));
    centerX = region.width / 2;
    centerY = region.height / 2;
    fadeRange = Math.max(slotH, region.height * 0.5);
    pxStep = 1 / Math.max(1, dpr);
    root.style.left = `${region.x}px`;
    root.style.top = `${region.y}px`;
    root.style.width = `${region.width}px`;
    root.style.height = `${region.height}px`;
    root.style.setProperty('--rv2-fade', `${Math.round(region.height * 0.16)}px`);
    world.style.perspective = `${Math.round(Math.max(MIN_PERSPECTIVE, region.height * (1.3 - 0.45 * depth)))}px`;
    const table: number[] = [0];
    let acc = 0;
    for (let x = TABLE_STEP; x <= TABLE_MAX + 1e-9; x += TABLE_STEP) {
      const n = Math.min(1, acc / fadeRange);
      const s = 1 - curve * n * n;
      const t = (tiltMax * Math.pow(n, 1.5) * Math.PI) / 180;
      acc += slotH * s * Math.cos(t) * TABLE_STEP;
      table.push(acc);
    }
    depthTable = table;
    for (const slab of slabs) {
      slab.el.style.width = `${cardW}px`;
      slab.el.style.height = `${cardH}px`;
      slab.el.style.left = `${centerX}px`;
      slab.el.style.marginLeft = `${-cardW / 2}px`;
      slab.el.style.marginTop = `${-cardH / 2}px`;
      slab.lastY = NaN;
      slab.lastScale = NaN;
      slab.lastTilt = NaN;
      slab.lastOpacity = NaN;
      slab.lastZ = -1;
    }
    layout();
  };

  const beginPan = (event: PointerEvent, el: HTMLDivElement, onTap: (() => void) | null): void => {
    if (!shown || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startPos = clamp(position, 0, maxIndex());
    let dragging = false;
    const samples: Array<{ t: number; y: number }> = [];
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    const onMove = (move: PointerEvent): void => {
      const dx = move.clientX - startX;
      const dy = move.clientY - startY;
      const now = performance.now();
      samples.push({ t: now, y: move.clientY });
      while (samples.length > 2 && now - (samples[0]?.t ?? 0) > 100) samples.shift();
      if (!dragging) {
        if (Math.abs(dx) < DRAG_DEAD && Math.abs(dy) < DRAG_DEAD) return;
        dragging = true;
        gliding = false;
        velocity = 0;
      }
      position = clamp(startPos - dy / slotH, 0, maxIndex());
      layout();
    };
    const detach = (): void => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', cancel);
    };
    const finish = (): void => {
      detach();
      if (!dragging) {
        if (onTap !== null) onTap();
        return;
      }
      suppressDbl = performance.now();
      const first = samples[0];
      const lastSample = samples[samples.length - 1];
      if (first !== undefined && lastSample !== undefined && lastSample.t > first.t) {
        velocity = clamp(((first.y - lastSample.y) / (lastSample.t - first.t)) * 1000, -WHEEL_MAX, WHEEL_MAX);
      }
      wake();
    };
    const cancel = (): void => {
      detach();
      if (dragging) {
        suppressDbl = performance.now();
        velocity = 0;
        wake();
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', cancel);
  };

  const buildSlab = (entry: RiverV2Entry, index: number, host: HTMLDivElement): Slab => {
    const el = document.createElement('div');
    el.className = entry.art === null ? 'rv2-card rv2-card-plain' : 'rv2-card';
    el.dataset.index = String(index);
    el.dataset.id = entry.id;
    if (entry.id === committedId) el.classList.add('committed');
    if (entry.art !== null) {
      const art = document.createElement('div');
      art.className = 'rv2-art';
      const img = document.createElement('img');
      img.src = entry.art;
      img.alt = '';
      img.decoding = 'async';
      art.append(img);
      const veil = document.createElement('div');
      veil.className = 'rv2-veil';
      el.append(art, veil);
    }
    const text = document.createElement('div');
    text.className = 'rv2-text';
    const title = document.createElement('span');
    title.className = 'rv2-title';
    title.textContent = entry.title;
    text.append(title);
    if (entry.meta.length > 0) {
      const meta = document.createElement('span');
      meta.className = 'rv2-meta';
      meta.textContent = entry.meta.join(' · ');
      text.append(meta);
    }
    el.append(text);
    host.append(el);
    el.addEventListener('pointerdown', (event) => {
      beginPan(event, el, () => {
        if (entryCb !== null) entryCb(entry.id);
      });
    });
    return {
      el,
      id: entry.id,
      index,
      hidden: false,
      lastY: NaN,
      lastScale: NaN,
      lastTilt: NaN,
      lastOpacity: NaN,
      lastZ: -1,
    };
  };

  const bindInput = (): void => {
    if (root === null || voidEl === null) return;
    root.addEventListener(
      'wheel',
      (event) => {
        if (!shown) return;
        event.preventDefault();
        gliding = false;
        velocity = clamp(velocity - event.deltaY * WHEEL_GAIN, -WHEEL_MAX, WHEEL_MAX);
        wake();
      },
      { passive: false },
    );

    voidEl.addEventListener('pointerdown', (event) => {
      beginPan(event, voidEl as HTMLDivElement, null);
    });

    voidEl.addEventListener('dblclick', (event) => {
      if (!shown) return;
      if (performance.now() - suppressDbl < 400) return;
      event.preventDefault();
      if (homeCb !== null) homeCb();
    });
  };

  return {
    mount(next: RiverV2Region, nextDpr: number): void {
      if (root === null || world === null || voidEl === null) {
        root = document.createElement('div');
        root.id = 'river-v2';
        voidEl = document.createElement('div');
        voidEl.className = 'rv2-void';
        world = document.createElement('div');
        world.className = 'rv2-world';
        root.append(voidEl, world);
        document.body.append(root);
        bindInput();
      }
      dpr = nextDpr;
      region = next;
      derive();
    },
    setRegion(next: RiverV2Region, nextDpr?: number): void {
      if (root === null) return;
      region = next;
      if (typeof nextDpr === 'number') dpr = nextDpr;
      derive();
    },
    setEntries(entries: RiverV2Entry[]): void {
      if (world === null) return;
      for (const slab of slabs) slab.el.remove();
      slabs = [];
      const host = world;
      entries.forEach((entry, index) => slabs.push(buildSlab(entry, index, host)));
      position = clamp(position, 0, maxIndex());
      derive();
    },
    scrollTo(index: number): void {
      position = clamp(index, 0, maxIndex());
      layout();
    },
    glideTo(index: number): void {
      const target = clamp(index, 0, maxIndex());
      const from = clamp(position, 0, maxIndex());
      const delta = target - from;
      if (delta === 0) return;
      glideFrom = from;
      glideDelta = delta;
      glideStart = performance.now();
      glideDuration = Math.max(700, Math.min(3000, Math.abs(delta) / 0.9));
      gliding = true;
      velocity = 0;
      wake();
    },
    scrollPosition(): number {
      return position;
    },
    setLayout(partial: Partial<RiverV2Layout>): void {
      if (typeof partial.visibleCount === 'number') visibleCount = clamp(Math.round(partial.visibleCount), 1, 12);
      if (typeof partial.depth === 'number') depth = clamp(partial.depth, 0, 2);
      derive();
    },
    setVisible(next: boolean): void {
      shown = next;
      root?.classList.toggle('on', next);
      if (!next) {
        window.cancelAnimationFrame(raf);
        raf = 0;
        velocity = 0;
        gliding = false;
        last = 0;
      }
    },
    onHome(cb: () => void): void {
      homeCb = cb;
    },
    onEntryActivated(cb: (id: string) => void): void {
      entryCb = cb;
    },
    setCommitted(id: string | null): void {
      committedId = id;
      for (const slab of slabs) slab.el.classList.toggle('committed', slab.id === id);
    },
    entryRect(id: string): DOMRect | null {
      const slab = slabs.find((s) => s.id === id);
      return slab !== undefined ? slab.el.getBoundingClientRect() : null;
    },
    hideEntry(id: string): void {
      const slab = slabs.find((s) => s.id === id);
      if (slab === undefined) return;
      slab.hidden = true;
      layout();
    },
    destroy(): void {
      window.cancelAnimationFrame(raf);
      root?.remove();
      root = null;
      world = null;
      voidEl = null;
      slabs = [];
    },
  };
}
