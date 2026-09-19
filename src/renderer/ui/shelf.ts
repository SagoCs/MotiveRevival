export interface ShelfEntry {
  id: string;
  name: string;
  ledger: string;
  art: string | null;
  initial: string;
  ref?: string;
}

export const SHELF_PLUS_ID = 'new:playlist';

export interface ShelfRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShelfCardState {
  id: string;
  x: number;
  scale: number;
  tilt: number;
  visible: boolean;
}

export interface ShelfHandle {
  mount(region: ShelfRegion, dpr: number): void;
  setRegion(region: ShelfRegion, dpr?: number): void;
  setEntries(entries: ShelfEntry[]): void;
  scrollTo(index: number): void;
  glideTo(index: number, speed?: number, maxMs?: number): void;
  scrollPosition(): number;
  centerIndex(): number;
  stepHold(dir: 1 | -1): void;
  stepRelease(): void;
  setVisible(visible: boolean): void;
  setSelected(id: string | null, colors?: { ledger: string; ring: string; glow: string }): void;
  setLitIds(ids: string[] | null): void;
  beginTransit(index: number, keep?: boolean): void;
  beginReturn(index: number, onDone: () => void, fromVisible?: boolean): void;
  returnFromScene(index: number, entries: ShelfEntry[], onDone: () => void): void;
  cancelTransit(): void;
  isBusy(): boolean;
  onVoidTap(cb: (taps: number) => void): void;
  onEntryTap(cb: (id: string) => void): void;
  onEntryContext(cb: (id: string) => void): void;
  onSettle(cb: (index: number) => void): void;
  speak(id: string | null, word?: string): void;
  entryRect(id: string): DOMRect | null;
  cardsState(): ShelfCardState[];
  destroy(): void;
}

interface Card {
  sig: string;
  el: HTMLDivElement;
  faceEl: HTMLDivElement;
  bloomEl: HTMLDivElement;
  veilEl: HTMLDivElement;
  veilWord: HTMLSpanElement;
  captionEl: HTMLDivElement;
  ledgerEl: HTMLDivElement;
  id: string;
  index: number;
  lastX: number;
  lastCapX: number;
  lastLedgerX: number;
  lastLedgerY: number;
  lastScale: number;
  lastTilt: number;
  lastOpacity: number;
  lastZ: number;
}

interface Transit {
  keep?: boolean;
  fromVisible?: boolean;
  fromOpacity?: string;
  held?: Map<string, { x: number; scale: number; tilt: number; opacity: number; capX: number; ledgerX: number; ledgerY: number }>;
  index: number;
  phase: 'open' | 'hold' | 'close';
  fadeStart: number;
  fadeDur: number;
  slideStart: number;
  slideDur: number;
}

const TRANSIT_FADE_OUT_MS = 520;
const TRANSIT_SLIDE_OUT_MS = 520;
const TRANSIT_FADE_IN_MS = 520;
const TRANSIT_SLIDE_HOME_MS = 560;
  const TRAVEL_MS = 700;

const DEFAULT_VISIBLE_COUNT = 7;
const DEFAULT_DEPTH = 0.9;
const SLOT_USE = 0.84;
const LENS_BOOST = 0.18;
const SNAP_DURATION = 380;
const SIZE_HEIGHT_CAP = 0.5;
const MIN_CARD = 96;
const MIN_PERSPECTIVE = 700;
const TABLE_STEP = 0.05;
const TABLE_MAX = 16;
const WHEEL_GAIN = 2.8;
const WHEEL_MAX = 13000;
const DECAY = 3.1;
const CRAWL = 5;
const DT_MAX = 50;
const DRAG_DEAD = 8;
const STAGGER_CAP = 420;
const WHEEL_QUIET = 140;
const SETTLE_TIME = Math.round(4000 / DECAY);
const STEP_HOLD_SPEED = 6;
const STEP_HOLD_WATCHDOG_MS = 250;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const entrySig = (entry: ShelfEntry): string => `${entry.name}|${entry.ledger}|${entry.art ?? ''}`;

export function createShelf(): ShelfHandle {
  let root: HTMLDivElement | null = null;
  let world: HTMLDivElement | null = null;
  let voidEl: HTMLDivElement | null = null;
  let cards: Card[] = [];
  let region: ShelfRegion = { x: 0, y: 0, width: 0, height: 0 };
  let dpr = 1;
  let visibleCount = DEFAULT_VISIBLE_COUNT;
  let depth = DEFAULT_DEPTH;
  let pxStep = 1;
  let slotW = 100;
  let cardSize = 0;
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
  let hideTimer = 0;
  let resting = true;
  let lastWheelAt = 0;
  let tapCb: ((id: string) => void) | null = null;
  let contextCb: ((id: string) => void) | null = null;
  let voidTapCb: ((taps: number) => void) | null = null;
  let voidTapTimer = 0;
  let voidTapCount = 0;
  let settleCb: ((index: number) => void) | null = null;
  let selectedId: string | null = null;
  let litIds: Set<string> | null = null;
  let transit: Transit | null = null;
  let holdDir = 0;
  let lastHoldAt = 0;
  let curve = 0.72;
  let tiltMax = 15;
  let fadeHold = 0.58;
  let lensAmt = 0;
  let depthTable: number[] = [0];

  const maxIndex = (): number => Math.max(0, cards.length - 1);

  const mod = (v: number, n: number): number => ((v % n) + n) % n;
  const wrapDist = (d: number, n: number): number => d - Math.round(d / n) * n;
  const wrapped = (): boolean => cards.length > visibleCount;

  const centerIndexNow = (): number => {
    const n = cards.length;
    return n > 0 ? mod(Math.round(anchorOf()), n) : 0;
  };

  const anchorOf = (): number => {
    const n = cards.length;
    if (n === 0) return 0;
    if (!wrapped()) {
      if (n <= 2) return (n - 1) / 2;
      return clamp(position, 0, n - 1);
    }
    return mod(position, n);
  };

  const distanceAt = (dist: number): number => {
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

  const clearTransitStyles = (): void => {
    for (const card of cards) {
      card.captionEl.style.opacity = '';
      card.ledgerEl.style.opacity = '';
    }
  };

  const renderTransit = (): void => {
    if (world === null || transit === null) return;
    const t = transit;
    const now = performance.now();
    let pFade: number;
    let pSlide: number;
    let slideEased = 1;
    if (t.phase === 'hold') {
      pFade = 1;
      pSlide = 1;
    } else {
      const fadeRaw = clamp((now - t.fadeStart) / t.fadeDur, 0, 1);
      const slideRaw = clamp((now - t.slideStart) / t.slideDur, 0, 1);
      const fadeEased = 1 - Math.pow(1 - fadeRaw, 3);
      slideEased = 1 - Math.pow(1 - slideRaw, 3);
      pFade = t.phase === 'open' ? fadeEased : 1 - fadeEased;
      pSlide = t.phase === 'open' ? slideEased : 1 - slideEased;
    }
    const restArt = `translate3d(0, 0, 0) rotateY(0deg) scale(${(1 + lensAmt).toFixed(4)})`;
    let anchor = anchorOf();
    const count = cards.length;
    let effFade = fadeRange;
    if (!wrapped() && count > visibleCount) {
      const shortSide = Math.min(anchor, count - 1 - anchor);
      effFade = clamp(shortSide * slotW * 0.92, slotW * 1.25, fadeRange);
    }
    const remap = fadeRange / effFade;
    const squash = effFade / fadeRange;
    const heldMap = t.held ?? null;
    const heldK = t.phase === 'hold' ? 1 : slideEased;
    for (const card of cards) {
      if (heldMap !== null) {
        const from = heldMap.get(card.id) ?? null;
        let dist = card.index - anchor;
        if (wrapped()) dist = wrapDist(dist, count);
        const side = Math.sign(dist) || 1;
        const xAbs = distanceAt(Math.abs(dist) * remap);
        const n = Math.min(1, xAbs / fadeRange);
        const trueScale = (1 - curve * n * n) * (1 + lensAmt * Math.exp(-dist * dist * 4));
        const trueTilt = side * tiltMax * Math.pow(n, 1.5);
        const trueOpacity = n <= fadeHold ? 1 : Math.max(0, 1 - Math.pow((n - fadeHold) / (1 - fadeHold), 2));
        const trueX = Math.round((side * xAbs * squash) / pxStep) * pxStep;
        const isChosen = card.index === t.index;
        const fromX = from !== null ? from.x : trueX;
        const fromScale = from !== null ? from.scale : trueScale;
        const fromTilt = from !== null ? from.tilt : trueTilt;
        const fromOpacity = from !== null ? from.opacity : trueOpacity;
        const x = fromX + (trueX - fromX) * heldK;
        const scale = fromScale + (trueScale - fromScale) * heldK;
        const tilt = fromTilt + (trueTilt - fromTilt) * heldK;
        const opacity = fromOpacity + (trueOpacity - fromOpacity) * heldK;
        const art = `translate3d(${x.toFixed(3)}px, 0, 0) rotateY(${tilt.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
        card.faceEl.style.transform = art;
        card.bloomEl.style.transform = art;
        card.el.style.opacity = opacity.toFixed(3);
        card.el.style.zIndex = isChosen ? '999' : '1';
        card.el.style.visibility = opacity <= 0 ? 'hidden' : 'visible';
        const capFrom = from !== null && Number.isFinite(from.capX) ? from.capX : x;
        const capX = capFrom + (trueX - capFrom) * heldK;
        const ledgerYT = Math.round((cardSize / 2 + scale * (cardSize / 2 + 35)) / pxStep) * pxStep;
        const ledgerFromY = from !== null && Number.isFinite(from.ledgerY) ? from.ledgerY : ledgerYT;
        const ledgerY = ledgerFromY + (ledgerYT - ledgerFromY) * heldK;
        const capT = `translate3d(${capX.toFixed(2)}px, 0, 0) rotateY(${tilt.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
        card.captionEl.style.transform = capT;
        card.ledgerEl.style.transform = `translate3d(${capX.toFixed(2)}px, ${ledgerY.toFixed(2)}px, 0)`;
        const capOp = Math.max(0, Math.min(1, opacity));
        card.captionEl.style.opacity = capOp.toFixed(3);
        card.ledgerEl.style.opacity = card.id === selectedId ? capOp.toFixed(3) : '0';
        card.lastX = x;
        card.lastScale = scale;
        card.lastTilt = tilt;
        card.lastOpacity = opacity;
        card.lastZ = isChosen ? 999 : 1;
        continue;
      }
      if (card.index === t.index) {
        const held = t.fromVisible === true && t.fromOpacity !== undefined;
        const chosenOpacity = t.keep === true ? 1 : held ? Number(t.fromOpacity) : 1 - pFade;
        card.faceEl.style.transform = restArt;
        card.bloomEl.style.transform = restArt;
        card.el.style.opacity = chosenOpacity.toFixed(4);
        card.el.style.zIndex = '999';
        card.el.style.visibility = chosenOpacity <= 0 ? 'hidden' : 'visible';
        card.captionEl.style.opacity = t.keep === true || held ? '1' : '0';
        card.ledgerEl.style.opacity = t.keep === true || held ? '1' : '0';
        card.lastX = 0;
        card.lastScale = 1 + lensAmt;
        card.lastTilt = 0;
        card.lastOpacity = chosenOpacity;
        card.lastZ = 999;
        continue;
      }
      let dist = card.index - anchor;
      if (wrapped()) dist = wrapDist(dist, count);
      const side = Math.sign(dist) || 1;
      const xAbs = distanceAt(Math.abs(dist) * remap);
      const n = Math.min(1, xAbs / fadeRange);
      const trueScale = (1 - curve * n * n) * (1 + lensAmt * Math.exp(-dist * dist * 4));
      const trueTilt = side * tiltMax * Math.pow(n, 1.5);
      const trueOpacity = n <= fadeHold ? 1 : Math.max(0, 1 - Math.pow((n - fadeHold) / (1 - fadeHold), 2));
      const trueX = Math.round((side * xAbs * squash) / pxStep) * pxStep;
      const x = trueX + side * region.width * 0.7 * pSlide;
      const opacity = t.fromVisible === true ? trueOpacity : t.phase === 'open' ? trueOpacity * (1 - pSlide * 1.6) : trueOpacity * Math.min(1, (1 - pSlide) * 1.8);
      const scale = trueScale * (1 - 0.15 * pSlide);
      const art = `translate3d(${x.toFixed(3)}px, 0, 0) rotateY(${trueTilt.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
      card.faceEl.style.transform = art;
      card.bloomEl.style.transform = art;
      card.el.style.opacity = opacity.toFixed(3);
      card.el.style.zIndex = '1';
      card.el.style.visibility = opacity <= 0 ? 'hidden' : 'visible';
      card.captionEl.style.opacity = '0';
      card.ledgerEl.style.opacity = '0';
      card.lastX = x;
      card.lastScale = scale;
      card.lastTilt = trueTilt;
      card.lastOpacity = opacity;
      card.lastZ = 1;
    }
  };

  const layout = (): void => {
    if (transit !== null) {
      renderTransit();
      return;
    }
    if (world === null || cards.length === 0) return;
    const anchor = anchorOf();
    const count = cards.length;
    let effFade = fadeRange;
    if (!wrapped() && count > visibleCount) {
      const shortSide = Math.min(anchor, count - 1 - anchor);
      effFade = clamp(shortSide * slotW * 0.92, slotW * 1.25, fadeRange);
    }
    const remap = fadeRange / effFade;
    const squash = effFade / fadeRange;
    for (const card of cards) {
      const total = cards.length;
      let dist = card.index - anchor;
      if (wrapped()) dist = wrapDist(dist, total);
      const side = Math.sign(dist);
      const xAbs = distanceAt(Math.abs(dist) * remap);
      const xOff = xAbs * squash;
      const n = Math.min(1, xAbs / fadeRange);
      const scale = (1 - curve * n * n) * (1 + lensAmt * Math.exp(-dist * dist * 4));
      const tilt = side * tiltMax * Math.pow(n, 1.5);
      const opacity = n <= fadeHold ? 1 : Math.max(0, 1 - Math.pow((n - fadeHold) / (1 - fadeHold), 2));
      const xStep = Math.round((side * xAbs * squash) / pxStep) * pxStep;
      const xGlide = side * xAbs * squash;
      const capX = resting ? xStep : xGlide;
      const zIdx = Math.round((1 - n) * 60);
      if (xStep !== card.lastX || scale !== card.lastScale || tilt !== card.lastTilt) {
        card.lastX = xStep;
        card.lastScale = scale;
        card.lastTilt = tilt;
        const art = `translate3d(${xStep.toFixed(3)}px, 0, 0) rotateY(${tilt.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
        card.faceEl.style.transform = art;
        card.bloomEl.style.transform = art;
      }
      if (capX !== card.lastCapX || scale !== card.lastScale || tilt !== card.lastTilt) {
        card.lastCapX = capX;
        card.captionEl.style.transform = `translate3d(${capX.toFixed(2)}px, 0, 0) rotateY(${tilt.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
      }
      const ledgerY = Math.round((cardSize / 2 + scale * (cardSize / 2 + 35)) / pxStep) * pxStep;
      if (capX !== card.lastLedgerX || ledgerY !== card.lastLedgerY) {
        card.lastLedgerX = capX;
        card.lastLedgerY = ledgerY;
        card.ledgerEl.style.transform = `translate3d(${capX.toFixed(2)}px, ${ledgerY.toFixed(2)}px, 0)`;
      }
      if (opacity !== card.lastOpacity) {
        card.lastOpacity = opacity;
        card.el.style.opacity = opacity.toFixed(4);
      }
      if (zIdx !== card.lastZ) {
        card.lastZ = zIdx;
        card.el.style.zIndex = String(zIdx);
      }
      card.el.style.visibility = n >= 1 ? 'hidden' : 'visible';
    }
  };

  const wake = (): void => {
    resting = false;
    if (!shown || raf !== 0) return;
    last = 0;
    raf = window.requestAnimationFrame(step);
  };

  const startGlide = (target: number, duration: number): void => {
    const from = position;
    const delta = target - from;
    if (Math.abs(delta) < 1e-4) {
      settleCb?.(centerIndexNow());
      return;
    }
    glideFrom = from;
    glideDelta = delta;
    glideStart = performance.now();
    glideDuration = duration;
    gliding = true;
    velocity = 0;
    wake();
  };

  const snapTarget = (predicted: number): number => {
    const n = cards.length;
    if (n === 0) return 0;
    const base = wrapped() ? predicted : clamp(predicted, 0, maxIndex());
    if (litIds === null || litIds.size === 0 || litIds.size >= n) return Math.round(base);
    let best = Math.round(base);
    let bestDist = Infinity;
    for (const card of cards) {
      if (!litIds.has(card.id)) continue;
      const raw = Math.abs(card.index - base);
      const d = wrapped() ? Math.abs(wrapDist(card.index - base, n)) : raw;
      if (d < bestDist) {
        bestDist = d;
        best = card.index;
      }
    }
    return best;
  };

  const glideTargetFrom = (wanted: number): number => (wrapped() ? position + wrapDist(wanted - position, cards.length) : wanted);

  const settleToMomentum = (): void => {
    const predicted = position + velocity / (DECAY * slotW);
    const target = glideTargetFrom(snapTarget(predicted));
    const travel = Math.abs(target - position);
    const duration = clamp(travel * 900, 260, SETTLE_TIME);
    velocity = 0;
    startGlide(target, duration);
  };

  const step = (ts: number): void => {
    raf = 0;
    const dtMs = last === 0 ? 16 : Math.min(DT_MAX, ts - last);
    last = ts;
    const dt = dtMs / 1000;
    let moving = false;
    if (cards.length > 0) {
      if (holdDir !== 0) {
        if (performance.now() - lastHoldAt > STEP_HOLD_WATCHDOG_MS) {
          holdDir = 0;
          startGlide(glideTargetFrom(snapTarget(position)), SNAP_DURATION);
          moving = gliding;
        } else {
          position += holdDir * STEP_HOLD_SPEED * dt;
          moving = true;
        }
      } else if (gliding) {
        const t = Math.min(1, (ts - glideStart) / glideDuration);
        position = glideFrom + glideDelta * (1 - Math.pow(1 - t, 4));
        if (t >= 1) {
          gliding = false;
          velocity = 0;
        } else moving = true;
      } else if (velocity !== 0) {
        if (ts - lastWheelAt > WHEEL_QUIET) {
          settleToMomentum();
          moving = gliding;
        } else {
          velocity *= Math.exp(-DECAY * dt);
          position += (velocity * dt) / slotW;
          if (Math.abs(velocity) < CRAWL) {
            velocity = 0;
            startGlide(glideTargetFrom(snapTarget(position)), SNAP_DURATION);
            moving = gliding;
          } else moving = true;
        }
      }
      if (!wrapped()) {
        const clamped = clamp(position, 0, maxIndex());
        if (clamped !== position) {
          position = clamped;
          if ((position <= 0 && velocity < 0) || (position >= maxIndex() && velocity > 0)) velocity = 0;
        }
      }
      layout();
    }
    if (moving || gliding) raf = window.requestAnimationFrame(step);
    else {
      resting = true;
      layout();
      last = 0;
      settleCb?.(centerIndexNow());
    }
  };

  const derive = (): void => {
    if (root === null || world === null) return;
    curve = clamp(0.45 + 0.3 * depth, 0.2, 0.9);
    tiltMax = clamp(6 + 9 * depth, 6, 22);
    fadeHold = clamp(0.35 + 0.25 * depth, 0, 0.85);
    lensAmt = LENS_BOOST;
    slotW = region.width / visibleCount;
    cardSize = Math.max(MIN_CARD, Math.min(Math.floor(slotW * SLOT_USE * dpr) / dpr, Math.floor(region.height * SIZE_HEIGHT_CAP * dpr) / dpr));
    centerX = region.width / 2;
    centerY = region.height / 2;
    fadeRange = Math.max(slotW, region.width * 0.5);
    pxStep = 1 / Math.max(1, dpr);
    root.style.left = `${region.x}px`;
    root.style.top = `${region.y}px`;
    root.style.width = `${region.width}px`;
    root.style.height = `${region.height}px`;
    root.style.setProperty('--shelf-fade', `${Math.round(region.width * 0.1)}px`);
    world.style.perspective = `${Math.round(Math.max(MIN_PERSPECTIVE, region.width * (1.3 - 0.45 * depth)))}px`;
    const table: number[] = [0];
    let acc = 0;
    for (let x = TABLE_STEP; x <= TABLE_MAX + 1e-9; x += TABLE_STEP) {
      const n = Math.min(1, acc / fadeRange);
      const s = (1 - curve * n * n) * (1 + lensAmt * Math.exp(-x * x * 4));
      const t = (tiltMax * Math.pow(n, 1.5) * Math.PI) / 180;
      acc += slotW * s * Math.cos(t) * TABLE_STEP;
      table.push(acc);
    }
    depthTable = table;
    for (const card of cards) {
      card.el.style.width = `${cardSize}px`;
      card.el.style.height = `${cardSize}px`;
      card.el.style.left = `${centerX}px`;
      card.el.style.top = `${centerY}px`;
      card.el.style.marginLeft = `${-cardSize / 2}px`;
      card.el.style.marginTop = `${-cardSize / 2}px`;
      card.faceEl.style.transformOrigin = '50% 50%';
      card.bloomEl.style.transformOrigin = '50% 50%';
      card.captionEl.style.transformOrigin = `50% ${(-cardSize / 2).toFixed(1)}px`;
      card.lastX = NaN;
      card.lastCapX = NaN;
      card.lastLedgerX = NaN;
      card.lastLedgerY = NaN;
      card.lastScale = NaN;
      card.lastTilt = NaN;
      card.lastOpacity = NaN;
      card.lastZ = -1;
    }
    layout();
  };

  const beginPan = (event: PointerEvent, el: HTMLDivElement, onTap: (() => void) | null): void => {
    if (!shown || transit !== null || event.button !== 0) return;
    const startX = event.clientX;
    const startPos = clamp(position, 0, maxIndex());
    let dragging = false;
    const samples: Array<{ t: number; x: number }> = [];
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    const onMove = (move: PointerEvent): void => {
      const dx = move.clientX - startX;
      const now = performance.now();
      samples.push({ t: now, x: move.clientX });
      while (samples.length > 2 && now - (samples[0]?.t ?? 0) > 100) samples.shift();
      if (!dragging) {
        if (Math.abs(dx) < DRAG_DEAD) return;
        dragging = true;
        gliding = false;
        velocity = 0;
        holdDir = 0;
      }
      const next = startPos - dx / slotW;
      position = wrapped() ? next : clamp(next, 0, maxIndex());
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
      const first = samples[0];
      const lastSample = samples[samples.length - 1];
      if (first !== undefined && lastSample !== undefined && lastSample.t > first.t) {
        velocity = clamp(((first.x - lastSample.x) / (lastSample.t - first.t)) * 1000, -WHEEL_MAX, WHEEL_MAX);
      }
      if (Math.abs(velocity) < CRAWL) {
        velocity = 0;
        startGlide(glideTargetFrom(snapTarget(position)), SNAP_DURATION);
      } else {
        settleToMomentum();
      }
      wake();
    };
    const cancel = (): void => {
      detach();
      if (dragging) {
        velocity = 0;
        wake();
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', cancel);
  };

    const applyEntryToCard = (card: Card, entry: ShelfEntry, index: number): void => {
      card.index = index;
      card.el.dataset.index = String(index);
      if (card.sig === entrySig(entry)) return;
      card.el.classList.toggle('shelf-card-plain', entry.art === null);
      card.faceEl.replaceChildren();
      if (entry.art !== null) {
        const img = document.createElement('img');
        img.src = entry.art;
        img.alt = '';
        img.decoding = 'async';
        img.loading = 'lazy';
        card.faceEl.append(img);
      } else {
        const initial = document.createElement('span');
        initial.className = 'shelf-initial';
        initial.textContent = entry.initial;
        card.faceEl.append(initial);
      }
      const nameEl = card.captionEl.querySelector('.shelf-name');
      if (nameEl !== null) nameEl.textContent = entry.name;
      card.ledgerEl.textContent = entry.ledger;
      card.sig = entrySig(entry);
    };

  const applyLitClasses = (): void => {
    for (const card of cards) {
      card.el.classList.toggle('dimmed', litIds !== null && !litIds.has(card.id) && card.id !== SHELF_PLUS_ID);
    }
  };

  const buildCard = (entry: ShelfEntry, index: number, host: HTMLDivElement): Card => {
    const el = document.createElement('div');
    el.className = entry.art === null ? 'shelf-card shelf-card-plain' : 'shelf-card';
    el.dataset.index = String(index);
    el.dataset.id = entry.id;
    const bloom = document.createElement('div');
    bloom.className = 'shelf-bloom';
    const face = document.createElement('div');
    face.className = 'shelf-face';    if (entry.art !== null) {
      const img = document.createElement('img');
      img.src = entry.art;
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      face.append(img);
    } else {
      const initial = document.createElement('span');
      initial.className = 'shelf-initial';
      initial.textContent = entry.initial;
      face.append(initial);
    }
    const caption = document.createElement('div');
    caption.className = 'shelf-caption';
    const name = document.createElement('span');
    name.className = 'shelf-name';
    name.textContent = entry.name;
    caption.append(name);
    const ledger = document.createElement('div');
    ledger.className = 'shelf-ledger';
    ledger.textContent = entry.ledger;
    const veil = document.createElement('div');
    veil.className = 'shelf-veil';
    const veilWord = document.createElement('span');
    veilWord.className = 'shelf-veil-word';
    veil.append(veilWord);
    face.append(veil);
    el.append(bloom, face, caption, ledger);
    if (index < STAGGER_CAP / 18) el.style.animationDelay = `${Math.min(index * 18, STAGGER_CAP)}ms`;
    host.append(el);
    face.addEventListener('pointerdown', (event) => {
      beginPan(event, face, () => {
        if (tapCb !== null) tapCb(entry.id);
      });
    });
    face.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (contextCb !== null) contextCb(entry.id);
    });
    return {
      sig: entrySig(entry),
      el,
      faceEl: face,
      bloomEl: bloom,
      veilEl: veil,
      veilWord,
      captionEl: caption,
      ledgerEl: ledger,
      id: entry.id,
      index,
      lastX: NaN,
      lastCapX: NaN,
      lastLedgerX: NaN,
      lastLedgerY: NaN,
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
        if (!shown || transit !== null) return;
        event.preventDefault();
        gliding = false;
        holdDir = 0;
        lastWheelAt = performance.now();
        velocity = clamp(velocity - event.deltaY * WHEEL_GAIN, -WHEEL_MAX, WHEEL_MAX);
        wake();
      },
      { passive: false },
    );
    voidEl.addEventListener('pointerdown', (event) => {
      beginPan(event, voidEl as HTMLDivElement, () => {
        voidTapCount += 1;
        if (voidTapTimer !== 0) window.clearTimeout(voidTapTimer);
        if (voidTapCount >= 3) {
          voidTapTimer = 0;
          voidTapCount = 0;
          voidTapCb?.(3);
          return;
        }
        voidTapTimer = window.setTimeout(() => {
          const taps = voidTapCount;
          voidTapTimer = 0;
          voidTapCount = 0;
          if (taps >= 2) voidTapCb?.(taps);
        }, 250);
      });
    });
  };

  const diffEntries = (entries: ShelfEntry[]): void => {
    if (world === null) return;
    const host = world;
    const byId = new Map<string, Card>();
    for (const card of cards) byId.set(card.id, card);
    let surgical = true;
    for (const entry of entries) {
      const card = byId.get(entry.id);
      if (card !== undefined && card.sig !== entrySig(entry)) {
        surgical = false;
        break;
      }
    }
    const nextIds = new Set(entries.map((e) => e.id));
    if (surgical) {
      const survivors = new Map<string, Card>();
      for (const card of cards) {
        if (nextIds.has(card.id)) survivors.set(card.id, card);
        else card.el.remove();
      }
      const next: Card[] = [];
      entries.forEach((entry, index) => {
        let card = survivors.get(entry.id);
        if (card === undefined) {
          card = buildCard(entry, index, host);
        } else {
          applyEntryToCard(card, entry, index);
        }
        next.push(card);
      });
      cards = next;
    } else {
      for (const card of cards) card.el.remove();
      cards = [];
      entries.forEach((entry, index) => cards.push(buildCard(entry, index, host)));
    }
  };

  return {
    mount(next: ShelfRegion, nextDpr: number): void {
      if (root === null || world === null || voidEl === null) {
        root = document.createElement('div');
        root.id = 'shelf';
        root.hidden = true;
        voidEl = document.createElement('div');
        voidEl.className = 'shelf-void';
        world = document.createElement('div');
        world.className = 'shelf-world';
        root.append(voidEl, world);
        document.body.append(root);
        bindInput();
      }
      dpr = nextDpr;
      region = next;
      derive();
    },
    setRegion(next: ShelfRegion, nextDpr?: number): void {
      if (root === null) return;
      region = next;
      if (typeof nextDpr === 'number') dpr = nextDpr;
      derive();
    },
    setEntries(entries: ShelfEntry[]): void {
      if (world === null) return;
      transit = null;
      diffEntries(entries);
      position = wrapped() ? mod(position, cards.length) : clamp(position, 0, maxIndex());
      if (selectedId !== null && !entries.some((e) => e.id === selectedId)) selectedId = null;
      applyLitClasses();
      derive();
    },
    scrollTo(index: number): void {
      position = wrapped() ? index : clamp(index, 0, maxIndex());
      layout();
      settleCb?.(centerIndexNow());
    },
    glideTo(index: number, speed = 1, maxMs = 1400): void {
      const n = cards.length;
      let target = index;
      if (wrapped()) target = position + wrapDist(index - position, n);
      else target = clamp(index, 0, maxIndex());
      const travel = Math.abs(target - position);
      startGlide(target, clamp((travel * 900) / speed, 500, maxMs));
    },
    scrollPosition(): number {
      return position;
    },
    centerIndex(): number {
      return centerIndexNow();
    },
    stepHold(dir: 1 | -1): void {
      if (!shown || cards.length === 0 || transit !== null) return;
      holdDir = dir;
      lastHoldAt = performance.now();
      gliding = false;
      velocity = 0;
      resting = false;
      wake();
    },
    stepRelease(): void {
      if (holdDir === 0) return;
      holdDir = 0;
      resting = false;
      startGlide(glideTargetFrom(snapTarget(position)), SNAP_DURATION);
    },
    setVisible(visible: boolean): void {
      shown = visible;
      if (root !== null) {
        if (visible) {
          if (hideTimer !== 0) {
            window.clearTimeout(hideTimer);
            hideTimer = 0;
          }
          root.hidden = false;
        } else if (!root.hidden) {
          hideTimer = window.setTimeout(() => {
            hideTimer = 0;
            if (!shown && root !== null) root.hidden = true;
          }, 850);
        }
      }
      root?.classList.toggle('on', visible);
      if (!visible) {
        window.cancelAnimationFrame(raf);
        raf = 0;
        velocity = 0;
        gliding = false;
        last = 0;
      } else {
        layout();
      }
    },
    setSelected(id: string | null, colors?: { ledger: string; ring: string; glow: string }): void {
      selectedId = id;
      for (const card of cards) {
        const on = card.id === id;
        card.el.classList.toggle('selected', on);
        if (on && colors !== undefined) {
          card.ledgerEl.style.color = colors.ledger;
          card.bloomEl.style.boxShadow = `0 0 0 1px ${colors.ring}, 0 0 34px ${colors.glow}`;
        }
      }
    },
    setLitIds(ids: string[] | null): void {
      litIds = ids !== null && ids.length > 0 ? new Set(ids) : null;
      applyLitClasses();
    },
    beginTransit(index: number, keep = false): void {
      if (cards.length === 0 || index < 0 || index >= cards.length) return;
      gliding = false;
      velocity = 0;
      resting = true;
      position = index;
      const now = performance.now();
      transit = { keep, index, phase: 'open', fadeStart: now, fadeDur: TRANSIT_FADE_OUT_MS, slideStart: now, slideDur: TRANSIT_SLIDE_OUT_MS };
      renderTransit();
      const run = (): void => {
        if (transit === null) return;
        renderTransit();
        const now = performance.now();
        if (now >= transit.fadeStart + transit.fadeDur && now >= transit.slideStart + transit.slideDur) {
          transit.phase = 'hold';
        } else {
          requestAnimationFrame(run);
        }
      };
      requestAnimationFrame(run);
    },
    beginReturn(index: number, onDone: () => void, fromVisible = false): void {
      if (cards.length === 0 || index < 0 || index >= cards.length) {
        onDone();
        return;
      }
      gliding = false;
      velocity = 0;
      resting = true;
      position = index;
      const now = performance.now();
      const chosen = cards[index];
      const fromOpacity = fromVisible && chosen !== undefined ? (chosen.el.style.opacity === '' ? '1' : chosen.el.style.opacity) : undefined;
      transit = { fromVisible, fromOpacity, index, phase: 'close', fadeStart: now, fadeDur: TRANSIT_FADE_IN_MS, slideStart: now, slideDur: TRANSIT_SLIDE_HOME_MS };
      renderTransit();
      const run = (): void => {
        if (transit === null) return;
        renderTransit();
        const now = performance.now();
        if (now >= transit.fadeStart + transit.fadeDur && now >= transit.slideStart + transit.slideDur) {
          transit = null;
          clearTransitStyles();
          layout();
          onDone();
          return;
        }
        requestAnimationFrame(run);
      };
      requestAnimationFrame(run);
    },
    cancelTransit(): void {
      if (transit === null) return;
      transit = null;
      clearTransitStyles();
      layout();
    },
    returnFromScene(index: number, entries: ShelfEntry[], onDone: () => void): void {
      if (world === null || cards.length === 0 || index < 0 || index >= cards.length) {
        diffEntries(entries);
        position = wrapped() ? mod(position, cards.length) : clamp(position, 0, maxIndex());
        if (selectedId !== null && !entries.some((e) => e.id === selectedId)) selectedId = null;
        applyLitClasses();
        derive();
        onDone();
        return;
      }
      const held = new Map<string, { x: number; scale: number; tilt: number; opacity: number; capX: number; ledgerX: number; ledgerY: number }>();
      for (const card of cards) {
        held.set(card.id, {
          x: card.lastX,
          scale: card.lastScale,
          tilt: card.lastTilt,
          opacity: card.lastOpacity,
          capX: Number.isFinite(card.lastCapX) ? card.lastCapX : card.lastX,
          ledgerX: Number.isFinite(card.lastLedgerX) ? card.lastLedgerX : card.lastX,
          ledgerY: Number.isFinite(card.lastLedgerY) ? card.lastLedgerY : 0,
        });
      }
      gliding = false;
      velocity = 0;
      resting = true;
      position = index;
      const now = performance.now();
      transit = { fromVisible: true, held, index, phase: 'close', fadeStart: now, fadeDur: TRANSIT_FADE_IN_MS, slideStart: now, slideDur: TRANSIT_SLIDE_HOME_MS };
      diffEntries(entries);
      position = wrapped() ? mod(position, cards.length) : clamp(position, 0, maxIndex());
      if (selectedId !== null && !entries.some((e) => e.id === selectedId)) selectedId = null;
      applyLitClasses();
      derive();
      const run = (): void => {
        if (transit === null) return;
        renderTransit();
        const now = performance.now();
        if (now >= transit.fadeStart + transit.fadeDur && now >= transit.slideStart + transit.slideDur) {
          transit = null;
          clearTransitStyles();
          layout();
          onDone();
          return;
        }
        requestAnimationFrame(run);
      };
      requestAnimationFrame(run);
    },
    isBusy(): boolean {
      return transit !== null;
    },
    onVoidTap(cb: (taps: number) => void): void {
      voidTapCb = cb;
    },
    onEntryTap(cb: (id: string) => void): void {
      tapCb = cb;
    },
    onEntryContext(cb: (id: string) => void): void {
      contextCb = cb;
    },
    onSettle(cb: (index: number) => void): void {
      settleCb = cb;
    },
    speak(id: string | null, word = ''): void {
      for (const card of cards) {
        const on = id !== null && card.id === id;
        card.veilEl.classList.toggle('speaking', on);
        if (on) card.veilWord.textContent = word;
      }
    },
    entryRect(id: string): DOMRect | null {
      const card = cards.find((c) => c.id === id);
      return card !== undefined ? card.faceEl.getBoundingClientRect() : null;
    },
    cardsState(): ShelfCardState[] {
      return cards.map((card) => ({
        id: card.id,
        x: centerX + card.lastX,
        scale: card.lastScale,
        tilt: card.lastTilt,
        visible: card.lastOpacity > 0,
      }));
    },
    destroy(): void {
      window.cancelAnimationFrame(raf);
      root?.remove();
      root = null;
      world = null;
      voidEl = null;
      cards = [];
    },
  };
}
