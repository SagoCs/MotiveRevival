export interface RiverV2Entry {
  id: string;
  title: string;
  meta: string[];
  art: string | null;
  artThumb?: string | null;
  tone?: string | null;
  ghost?: boolean;
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
  ring: boolean;
  smallSetPin: boolean;
}

export interface RiverV2Handle {
  mount(region: RiverV2Region, dpr: number, rootId?: string): void;
  setRegion(region: RiverV2Region, dpr?: number): void;
  setEntries(entries: RiverV2Entry[]): void;
  scrollTo(index: number): void;
  glideTo(index: number, durationMs?: number): void;
  scrollPosition(): number;
  setLayout(layout: Partial<RiverV2Layout>): void;
  setVisible(visible: boolean): void;
  onHome(cb: () => void): void;
  onEntryActivated(cb: (id: string) => void): void;
  onEntryContext(cb: (id: string, card: HTMLDivElement) => void): void;
  setCommitted(id: string | null): void;
  setDimSpan(first: number, last: number | null): void;
  step(dir: 1 | -1, repeat?: boolean): void;
  stepHold(dir: 1 | -1): void;
  stepRelease(): void;
  centerId(): string | null;
  entryRect(id: string): DOMRect | null;
  hideEntry(id: string): void;
  destroy(): void;
}

interface Slab {
  el: HTMLDivElement;
  id: string;
  index: number;
  ghost: boolean;
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
const CONTEXT_MIN_RATIO = 0.55;
const TABLE_STEP = 0.05;
const TABLE_MAX = 16;
const SPAN_CURVE_FLOOR = 0.25;
const SPAN_REACH_SONGS = 0.6;
const STEP_CHAIN_MS = 240;
const STEP_TAP_MS = 420;
const STEP_HOLD_SPEED = 6;
const STEP_HOLD_WATCHDOG_MS = 250;
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
  let ring = false;
  let smallSetPin = true;
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
  let contextCb: ((id: string, card: HTMLDivElement) => void) | null = null;
  let committedId: string | null = null;
  let dimSpan: { first: number; last: number } | null = null;
  let holdDir = 0;
  let lastHoldAt = 0;
  let curve = 0.75;
  let tiltMax = 52;
  let fadeHold = 0.6;
  let lensAmt = 0;
  let lensQ = 1 / (LENS_WIDTH * LENS_WIDTH);
  let depthTable: number[] = [0];
  let depthTableFlat: number[] = [0];

  const maxIndex = (): number => Math.max(0, slabs.length - 1);

  const wrapDist = (d: number, n: number): number => d - Math.round(d / n) * n;

  const wrapped = (): boolean => ring && dimSpan === null && slabs.length >= visibleCount;

  const clampPos = (value: number): number => {
    if (dimSpan !== null) return clamp(value, dimSpan.first, dimSpan.last);
    if (wrapped()) return value;
    return clamp(value, 0, maxIndex());
  };

  const anchorOf = (): number => {
    const count = slabs.length;
    if (count === 0) return 0;
    if (wrapped()) return (((position % count) + count) % count);
    if (count <= visibleCount && smallSetPin) return (count - 1) / 2;
    return clamp(position, 0, count - 1);
  };

  const depthAt = (table: number[], dist: number): number => {
    const cover = (table.length - 1) * TABLE_STEP;
    if (dist > cover) return fadeRange * 2;
    const pos = dist / TABLE_STEP;
    const idx = Math.floor(pos);
    const lastIdx = table.length - 1;
    if (idx >= lastIdx) return table[lastIdx] ?? 0;
    const frac = pos - idx;
    const a = table[idx] ?? 0;
    const b = table[idx + 1] ?? 0;
    return a + (b - a) * frac;
  };

  const layout = (): void => {
    if (world === null || slabs.length === 0) return;
    const anchor = anchorOf();
    const count = slabs.length;
    const wrappedNow = wrapped();
    const lo = dimSpan !== null ? dimSpan.first : 0;
    const hi = dimSpan !== null ? dimSpan.last : count - 1;
    const edge = Math.min(anchor - lo, hi - anchor);
    const deep = wrappedNow ? 1 : clamp(edge / Math.max(1, visibleCount * SPAN_REACH_SONGS), 0, 1);
    const effCurve = curve * (SPAN_CURVE_FLOOR + (1 - SPAN_CURVE_FLOOR) * deep);
    let effFade = fadeRange;
    if (!wrapped() && slabs.length > visibleCount) {
      const shortSide = Math.min(anchor - lo, hi - anchor);
      effFade = clamp(shortSide * slotH * 0.92, slotH * 1.25, fadeRange);
    }
    const remap = fadeRange / effFade;
    const ySquash = effFade / fadeRange;
    for (const slab of slabs) {
      let dist = slab.index - anchor;
      if (wrapped()) dist = wrapDist(dist, count);
      const side = Math.sign(dist) || 1;
      const dAbs = Math.abs(dist) * remap;
      const yAbs = depthAt(depthTable, dAbs) + (depthAt(depthTableFlat, dAbs) - depthAt(depthTable, dAbs)) * (1 - deep);
      const yOff = yAbs * ySquash;
      const n = Math.min(1, yAbs / fadeRange);
      const scale = (1 - effCurve * n * n) * (1 + lensAmt * Math.exp(-dist * dist * lensQ));
      const tilt = -side * tiltMax * Math.pow(n, 1.5);
      const opacity = (n <= fadeHold ? 1 : Math.max(0, 1 - Math.pow((n - fadeHold) / (1 - fadeHold), 2))) * (slab.ghost ? 0.18 : 1) * (dimSpan !== null && (slab.index < dimSpan.first || slab.index > dimSpan.last) ? 0.13 : 1);
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

  const beginGlide = (index: number, durationMs = 0): void => {
    let target = index;
    if (wrapped()) target = position + wrapDist(index - position, slabs.length);
    else if (dimSpan !== null) target = clamp(index, dimSpan.first, dimSpan.last);
    else target = clamp(index, 0, maxIndex());
    const from = position;
    const delta = target - from;
    if (delta === 0) return;
    glideFrom = from;
    glideDelta = delta;
    glideStart = performance.now();
    glideDuration = durationMs > 0 ? durationMs : Math.max(700, Math.min(3000, Math.abs(delta) / 0.9));
    gliding = true;
    velocity = 0;
    wake();
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
      if (holdDir !== 0) {
        if (performance.now() - lastHoldAt > STEP_HOLD_WATCHDOG_MS) {
          holdDir = 0;
          beginGlide(Math.round(position), 300);
        } else {
          position += holdDir * STEP_HOLD_SPEED * dt;
        }
      } else if (gliding) {
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
      if (!wrapped()) {
        const lo = dimSpan !== null ? dimSpan.first : 0;
        const hi = dimSpan !== null ? dimSpan.last : maxIndex();
        const clamped = clamp(position, lo, hi);
        if (clamped !== position) {
          position = clamped;
          if ((position <= lo && velocity < 0) || (position >= hi && velocity > 0)) velocity = 0;
        }
      }
      layout();
    }
    if (holdDir !== 0 || gliding || velocity !== 0) raf = window.requestAnimationFrame(step);
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
    const buildTable = (c: number): number[] => {
      const table: number[] = [0];
      let acc = 0;
      for (let x = TABLE_STEP; x <= TABLE_MAX + 1e-9; x += TABLE_STEP) {
        const n = Math.min(1, acc / fadeRange);
        const s = 1 - c * n * n;
        const t = (tiltMax * Math.pow(n, 1.5) * Math.PI) / 180;
        acc += slotH * s * Math.cos(t) * TABLE_STEP;
        table.push(acc);
      }
      return table;
    };
    depthTable = buildTable(curve);
    depthTableFlat = buildTable(curve * SPAN_CURVE_FLOOR);
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
        holdDir = 0;
      }
      position = dimSpan !== null
        ? clamp(startPos - dy / slotH, dimSpan.first, dimSpan.last)
        : wrapped()
          ? startPos - dy / slotH
          : clamp(startPos - dy / slotH, 0, maxIndex());
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
    if (entry.ghost === true) {
      el.classList.add('rv2-ghost');
      el.classList.remove('rv2-card-plain');
    }
    el.dataset.index = String(index);
    el.dataset.id = entry.id;
    el.style.setProperty('--slab-index', String(index));
    if (entry.id === committedId) el.classList.add('committed');
    if (entry.tone !== undefined && entry.tone !== null) el.style.setProperty('--rv2-tone', entry.tone);
    if (entry.art !== null) {
      const art = document.createElement('div');
      art.className = 'rv2-art';
      const artUrl = entry.art;
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      if (entry.artThumb !== undefined && entry.artThumb !== null) {
        img.src = entry.artThumb;
        const full = new Image();
        full.decoding = 'async';
        full.onload = (): void => {
          img.src = artUrl;
        };
        full.src = artUrl;
      } else {
        img.src = artUrl;
      }
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
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (!shown) return;
      if (el.getBoundingClientRect().height < cardH * CONTEXT_MIN_RATIO) return;
      if (contextCb !== null) contextCb(entry.id, el);
    });
    return {
      el,
      id: entry.id,
      index,
      ghost: entry.ghost === true,
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
        holdDir = 0;
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
    mount(next: RiverV2Region, nextDpr: number, rootId = 'river-v2'): void {
      if (root === null || world === null || voidEl === null) {
        root = document.createElement('div');
        root.id = rootId;
        root.className = 'rv2-root';
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
      dimSpan = null;
      for (const slab of slabs) slab.el.remove();
      slabs = [];
      const host = world;
      entries.forEach((entry, index) => slabs.push(buildSlab(entry, index, host)));
      position = wrapped() ? (((position % slabs.length) + slabs.length) % slabs.length) : clamp(position, 0, maxIndex());
      derive();
    },
    scrollTo(index: number): void {
      position = wrapped() ? (((index % slabs.length) + slabs.length) % slabs.length) : clamp(index, 0, maxIndex());
      layout();
    },
    glideTo(index: number, durationMs = 0): void {
      beginGlide(index, durationMs);
    },
    scrollPosition(): number {
      return position;
    },
    setLayout(partial: Partial<RiverV2Layout>): void {
      if (typeof partial.visibleCount === 'number') visibleCount = clamp(Math.round(partial.visibleCount), 1, 12);
      if (typeof partial.depth === 'number') depth = clamp(partial.depth, 0, 2);
      if (typeof partial.ring === 'boolean') ring = partial.ring;
      if (typeof partial.smallSetPin === 'boolean') smallSetPin = partial.smallSetPin;
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
    onEntryContext(cb: (id: string, card: HTMLDivElement) => void): void {
      contextCb = cb;
    },
    setCommitted(id: string | null): void {
      committedId = id;
      for (const slab of slabs) slab.el.classList.toggle('committed', slab.id === committedId);
    },
    setDimSpan(first: number, last: number | null): void {
      dimSpan = last === null || last < first ? null : { first, last };
      position = dimSpan !== null ? clamp(position, dimSpan.first, dimSpan.last) : clamp(position, 0, maxIndex());
      derive();
    },
    step(dir: 1 | -1, repeat = false): void {
      const destination = gliding ? glideFrom + glideDelta : this.scrollPosition();
      const target = (repeat ? Math.round(this.scrollPosition()) : Math.round(destination)) + dir;
      this.glideTo(target, repeat ? STEP_CHAIN_MS : gliding ? STEP_CHAIN_MS : STEP_TAP_MS);
    },
    stepHold(dir: 1 | -1): void {
      if (!shown || slabs.length === 0) return;
      holdDir = dir;
      lastHoldAt = performance.now();
      gliding = false;
      velocity = 0;
      wake();
    },
    stepRelease(): void {
      if (holdDir === 0) return;
      holdDir = 0;
      beginGlide(Math.round(clampPos(position)), 300);
    },
    centerId(): string | null {
      if (slabs.length === 0) return null;
      const anchor = anchorOf();
      const slab = slabs.find((s) => s.index === Math.round(anchor));
      return slab?.id ?? null;
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
