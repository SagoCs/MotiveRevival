import '@fontsource/sora/300.css';
import '@fontsource/ibm-plex-mono/400.css';
import './sim.css';
import { createRenderer, type Renderer } from './gl';
import { STAR_FRAG, STAR_VERT } from './starShaders';

type StarLook = {
  bodyScale: number;
  prongCount: number;
  spikeLength: number;
  fuse: number;
  hue: number;
  sat: number;
  motes: number;
  orientation: number;
  spinSpeed: number;
};

type SkyParams = {
  clusters: number;
  corridor: number;
  minGap: number;
  roster: number;
  dustGain: number;
  fieldDensity: number;
  fieldGain: number;
  farGain: number;
  bloomGain: number;
  spikeGain: number;
  moteGain: number;
};

const BASE_PX = 90;
const MAX_SPARKLES = 14;
const BOX_FLOOR_DPR = 96;
const ZOOM_MIN = 0.06;
const ZOOM_MAX = 8;
const WORLD_W = 210;
const WORLD_H = 135;
const STORE_KEY = 'universe-lab-v10';
const RECIPE_SCHEMA = 10;

type RGB = [number, number, number];

type Artist = {
  name: string;
  hash: number;
  bodyScale: number;
  prongCount: number;
  spikeLength: number;
  fuse: number;
  hue: number;
  sat: number;
  motes: number;
  orientation: number;
  spinSpeed: number;
  court: Float32Array;
  prongs: Float32Array;
  cols: { core: RGB; body: RGB; bloom: RGB; heart: RGB; rim: RGB };
  x: number;
  y: number;
  gapR: number;
  coverage: number;
};

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const rgb = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [rgb[0]! + m, rgb[1]! + m, rgb[2]! + m];
}

function mix3(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function hashName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYLLABLES = ['mi', 'ka', 'ru', 'sen', 'va', 'lo', 'thi', 'ra', 'el', 'no', 'dra', 'su', 'yne', 'cal', 'or', 'ash', 'bel', 'tir', 'ume', 'qua', 'fen', 'zil', 'mor', 'hei', 'lun', 'cir', 'vex', 'ola', 'nyx', 'pet'];

function makeName(rand: () => number): string {
  const n = 2 + Math.floor(rand() * 2);
  let s = '';
  for (let i = 0; i < n; i++) s += SYLLABLES[Math.floor(rand() * SYLLABLES.length)];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function layoutProngs(seed: number, count: number): Float32Array {
  const pr = mulberry32(seed ^ 0x9e3779b9);
  const order = 0.35 + 0.5 * Math.pow(pr(), 1.35);
  const jitter = 0.4 - 0.33 * order;
  const hierarchy = 0.85 - 0.4 * order;
  const minLen = 0.25 + 0.3 * order;
  const nonDomMax = Math.max(minLen + 0.05, hierarchy * 0.92);
  const step = (Math.PI * 2) / Math.max(1, count);
  const data = new Float32Array(12 * 4);
  for (let i = 0; i < 12; i++) {
    let lenFactor = 0;
    if (i >= count) {
      lenFactor = 0;
    } else if (i < 2) {
      lenFactor = hierarchy * (0.95 + 0.05 * pr());
    } else {
      lenFactor = minLen + (nonDomMax - minLen) * Math.pow(pr(), 1.3) + (pr() - 0.5) * 0.06;
    }
    lenFactor = Math.min(1, Math.max(0.2, lenFactor));
    data[i * 4] = i * step + (pr() - 0.5) * 2 * jitter;
    data[i * 4 + 1] = lenFactor;
    data[i * 4 + 2] = 0.75 + 0.6 * pr();
    data[i * 4 + 3] = i < count ? 0.55 + 0.45 * pr() : 0;
  }
  return data;
}

const boot = (): void => {
  const stage = document.querySelector('#stage');
  if (!(stage instanceof HTMLElement)) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'lab-canvas';
  stage.append(canvas);

  const result = createRenderer(canvas, STAR_VERT, STAR_FRAG);
  const fatal = (message: string): void => {
    const div = document.createElement('div');
    div.className = 'lab-fatal';
    div.textContent = message;
    stage.append(div);
  };
  if (!result.ok) {
    fatal(result.error);
    (window as unknown as Record<string, unknown>).__lab = { ok: false, error: result.error };
    return;
  }
  const r: Renderer = result.renderer;

  const saved = (() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const parsed = raw ? (JSON.parse(raw) as { schema?: number; sky?: Partial<SkyParams> }) : null;
      return parsed && parsed.schema === RECIPE_SCHEMA ? parsed : null;
    } catch {
      return null;
    }
  })();

  const sky: SkyParams = {
    clusters: 5, corridor: 1.1, minGap: 1.6, roster: 40, dustGain: 1.0, fieldDensity: 0.5, fieldGain: 0.8, farGain: 0.3, bloomGain: 0.55, spikeGain: 1.3, moteGain: 1.15,
    ...(saved?.sky ?? {}),
  };

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let zoom = 1;
  let camX = WORLD_W / 2;
  let camY = WORLD_H / 2;
  let driftAngle = 0;
  let dirty = true;
  const glErrors: string[] = [];

  const pxPerUnitDevice = (): number => BASE_PX * dpr * zoom;

  type Cluster = { x: number; y: number; sigma: number; strength: number };
  let clusters: Cluster[] = [];
  let corridorAngle = 0;
  let artists: Artist[] = [];

  const buildClusters = (): void => {
    const pr = mulberry32(777);
    clusters = [];
    const n = Math.round(sky.clusters);
    for (let i = 0; i < n; i++) {
      clusters.push({
        x: 15 + pr() * (WORLD_W - 30),
        y: 15 + pr() * (WORLD_H - 30),
        sigma: 14 + pr() * 26,
        strength: 0.7 + pr() * 0.9,
      });
    }
    corridorAngle = pr() * Math.PI;
  };

  const densityAt = (x: number, y: number): number => {
    let d = 1;
    for (const c of clusters) {
      const dx = x - c.x;
      const dy = y - c.y;
      d += c.strength * Math.exp(-(dx * dx + dy * dy) / (2 * c.sigma * c.sigma));
    }
    const cosA = Math.cos(corridorAngle);
    const sinA = Math.sin(corridorAngle);
    const dPerp = -sinA * (x - WORLD_W / 2) + cosA * (y - WORLD_H / 2);
    d += sky.corridor * Math.exp(-(dPerp * dPerp) / 968);
    return d;
  };

  const maxDensity = (): number => 1 + Math.round(sky.clusters) * 1.6 + sky.corridor;

  const buildRoster = (): void => {
    const pr = mulberry32(20260908);
    const count = Math.round(sky.roster);
    const raw: Artist[] = [];
    for (let i = 0; i < count; i++) {
      const name = makeName(pr);
      const hash = hashName(name);
      const ph = mulberry32(hash);
      const massRank = Math.pow(pr(), 2.6);
      const prongCount = 6 + Math.floor(ph() * 5);
      raw.push({
        name,
        hash,
        bodyScale: 0.28 + massRank * 0.55,
        prongCount,
        spikeLength: 2.4 + ph() * 1.0,
        fuse: 0.4 + ph() * 0.4,
        hue: [20, 45, 200, 262, 330][Math.floor(ph() * 5) % 5]! + (ph() - 0.5) * 24,
        sat: 0.3 + ph() * 0.25,
        motes: 6 + Math.floor(ph() * 6),
        orientation: (ph() - 0.5) * 0.7,
        spinSpeed: (ph() - 0.5) * 0.02,
        court: new Float32Array(0),
        prongs: layoutProngs(hash, prongCount),
        cols: { core: [0, 0, 0], body: [0, 0, 0], bloom: [0, 0, 0], heart: [0, 0, 0], rim: [0, 0, 0] },
        x: 0,
        y: 0,
        gapR: 0,
        coverage: 0,
      });
    }
    raw.sort((a, b) => b.bodyScale - a.bodyScale);
    for (const a of raw) {
      a.gapR = a.bodyScale * 2.2 + 1.2;
      a.coverage = a.bodyScale * (Math.max(a.spikeLength, 3.2) + 1.9);
      const body = hslToRgb(a.hue, a.sat, 0.62);
      a.cols.body = body;
      a.cols.core = mix3(body, [1, 1, 1], 0.85);
      a.cols.bloom = hslToRgb(a.hue - 10, 0.5, 0.6);
      a.cols.heart = hslToRgb(a.hue + 30, 0.8, 0.62);
      a.cols.rim = hslToRgb(a.hue + 26, 0.6, 0.74);
    }
    artists = raw;
    placeArtists();
  };

  const placeArtists = (): void => {
    const pr = mulberry32(555000 + Math.round(sky.roster));
    const maxD = maxDensity();
    const placed: Artist[] = [];
    for (const a of artists) {
      let bestX = 9 + pr() * (WORLD_W - 18);
      let bestY = 9 + pr() * (WORLD_H - 18);
      let bestScore = -1;
      for (let t = 0; t < 260; t++) {
        const x = 9 + pr() * (WORLD_W - 18);
        const y = 9 + pr() * (WORLD_H - 18);
        if (placed.length > 0 && pr() > densityAt(x, y) / maxD) continue;
        let minDist = Infinity;
        let blocked = false;
        for (const p of placed) {
          const dx = x - p.x;
          const dy = y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < sky.minGap * (a.gapR + p.gapR)) { blocked = true; break; }
          if (dist < minDist) minDist = dist;
        }
        if (blocked) continue;
        const score = minDist + densityAt(x, y) * 4;
        if (score > bestScore) { bestScore = score; bestX = x; bestY = y; }
        if (t > 40 || placed.length === 0) break;
      }
      a.x = bestX;
      a.y = bestY;
      placed.push(a);
    }
  };

  const sparkScratch = new Float32Array(MAX_SPARKLES * 4);
  const metaScratch = new Float32Array(MAX_SPARKLES * 4);

  const draw = (time: number): void => {
    const ppu = pxPerUnitDevice();
    const hw = canvas.width / 2;
    const hh = canvas.height / 2;

    r.setBlend(false);
    r.setViewport(0, 0, canvas.width, canvas.height);
    r.setV2('uResolution', canvas.width, canvas.height);
    r.setV2('uViewOrigin', 0, 0);
    r.setF('uTime', time);
    r.setV2('uCam', camX, camY);
    r.setF('uPxPerUnit', ppu);
    r.setF('uDpr', dpr);
    r.setF('uExposure', 1.5);
    r.setF('uStarGain', 0);
    r.setF('uVoidGain', 1);
    r.setF('uFieldDensity', sky.fieldDensity);
    r.setF('uFieldGain', sky.fieldGain);
    r.drawFullscreen();

    r.setBlend(true);
    const zoomClamp = Math.min(1, zoom);
    const gainScale = sky.farGain + (1 - sky.farGain) * zoomClamp;
    const farMix = 1 - zoomClamp;
    let starDraws = 0;
    for (const a of artists) {
      const sxD = hw + (a.x - camX) * ppu;
      const syD = hh + (a.y - camY) * ppu;
      const half = Math.max(a.coverage * ppu, BOX_FLOOR_DPR * dpr);
      if (sxD + half < 0 || sxD - half > canvas.width || syD + half < 0 || syD - half > canvas.height) continue;
      let vx = Math.max(0, Math.floor(sxD - half));
      let vy = Math.max(0, Math.floor(syD - half));
      let vw = Math.min(canvas.width, Math.ceil(sxD + half)) - vx;
      let vh = Math.min(canvas.height, Math.ceil(syD + half)) - vy;
      if (labRecord['debugFull']) { vx = 0; vy = 0; vw = canvas.width; vh = canvas.height; }
      if (vw <= 0 || vh <= 0) continue;
      r.setViewport(vx, vy, vw, vh);
      r.setV2('uResolution', vw, vh);
      r.setV2('uViewOrigin', vx, vy);
      r.setV2('uCam', (vx + vw / 2 - sxD) / ppu, (vy + vh / 2 - syD) / ppu);
      r.setF('uTime', time);
      r.setF('uPxPerUnit', ppu);
      r.setF('uDpr', dpr);
      r.setF('uExposure', 1.5);
      r.setF('uStarGain', gainScale);
      r.setF('uFarMix', farMix);
      r.setF('uVoidGain', 0);
      r.setV3('uColorCore', a.cols.core[0], a.cols.core[1], a.cols.core[2]);
      r.setV3('uColorBody', a.cols.body[0], a.cols.body[1], a.cols.body[2]);
      r.setV3('uColorBloom', a.cols.bloom[0], a.cols.bloom[1], a.cols.bloom[2]);
      r.setV3('uColorHeart', a.cols.heart[0], a.cols.heart[1], a.cols.heart[2]);
      r.setV3('uColorRim', a.cols.rim[0], a.cols.rim[1], a.cols.rim[2]);
      r.setF('uCoreRadius', a.bodyScale * 0.3);
      r.setF('uBodyRadius', a.bodyScale);
      r.setF('uHeartMix', 0.3);
      r.setV3('uBloomRadius', 1.7, 2.1, 5.5);
      r.setV3('uBloomGain', 0.42 * Math.min(1, a.bodyScale * 2.4) * sky.bloomGain, 0.055, 0.007);
      r.setF('uSpikeLength', a.spikeLength);
      r.setF('uSpikeWidth', 1.3);
      r.setF('uSpikeGain', 0.4 * sky.spikeGain);
      r.setF('uSpikeAngle', a.orientation + time * a.spinSpeed);
      r.setF('uOrientation', a.orientation);
      r.setF('uFuse', a.fuse);
      r.setF('uDisperse', 0.5);
      r.setF('uFacetGain', 0.25);
      r.setI('uProngCount', a.prongCount);
      r.setV4Array('uProngs', a.prongs);
      const ds = mulberry32(a.hash ^ 0x51ab);
      const bodyPx = a.bodyScale * ppu;
      let spikyCount = 0;
      for (let i = 0; i < MAX_SPARKLES; i++) {
        if (i >= a.motes) {
          sparkScratch[i * 4 + 3] = -1;
          continue;
        }
        const inner = ds() < 0.5;
        const band = inner ? 1.3 + 0.5 * ds() : 1.9 + 1.0 * ds();
        const phase = ds() * Math.PI * 2;
        const speed = (0.02 + ds() * 0.06) * (ds() < 0.5 ? -1 : 1);
        const ang = phase + speed * time;
        sparkScratch[i * 4] = Math.cos(ang) * band * bodyPx;
        sparkScratch[i * 4 + 1] = Math.sin(ang) * band * bodyPx;
        sparkScratch[i * 4 + 2] = Math.max(1.6, bodyPx * 0.14 * (0.7 + ds() * 0.6));
        sparkScratch[i * 4 + 3] = phase;
        metaScratch[i * 4] = ds();
        metaScratch[i * 4 + 1] = ds();
        metaScratch[i * 4 + 2] = ds();
        const spiky = ds() < 0.25 && spikyCount < 2;
        if (spiky) spikyCount++;
        metaScratch[i * 4 + 3] = spiky ? 1 : 0;
      }
      r.setI('uSparkleCount', a.motes);
      r.setV4Array('uSparkles', sparkScratch);
      r.setV4Array('uSparkMeta', metaScratch);
      r.setF('uSparkleGain', 0.6 * sky.dustGain * sky.moteGain);
      r.setF('uShimmer', 0.18);
      r.setF('uFlicker', 0.06);
      r.setF('uFieldDensity', 0);
      r.setF('uFieldGain', 0);
      starDraws++;
      const e = r.gl.getError();
      if (e !== 0 && glErrors.length < 6) glErrors.push('GL err after star draw: ' + e);
      r.drawFullscreen();
    }
    const loopErr = r.gl.getError();
    if (loopErr !== 0) glErrors.push('post-loop GL err: ' + loopErr);
    if (starDraws !== artists.length) glErrors.push('drew ' + starDraws + ' of ' + artists.length);
    r.setBlend(false);
  };

  const resize = (): void => {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    dirty = true;
  };

  const save = (): void => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ schema: RECIPE_SCHEMA, sky }));
    } catch {}
  };

  const hud = document.createElement('div');
  hud.id = 'lab-hud';
  hud.className = 'hidden';
  stage.append(hud);
  const sliders = new Map<string, HTMLInputElement>();
  const readouts = new Map<string, HTMLElement>();

  const GROUPS: { title: string; rows: [string, string, number, number, number][] }[] = [
    { title: 'Population', rows: [
      ['clusters', 'Clusters', 0, 8, 1],
      ['corridor', 'Corridor', 0, 2, 0.05],
      ['minGap', 'Politeness', 1.2, 3.2, 0.05],
      ['dustGain', 'Dust gain', 0, 1.5, 0.01],
    ] },
    { title: 'Field', rows: [
      ['fieldDensity', 'Field density', 0, 1, 0.01],
      ['fieldGain', 'Field gain', 0, 1.6, 0.01],
    ] },
    { title: 'Distance', rows: [
      ['farGain', 'Far gain', 0.1, 1, 0.01],
    ] },
    { title: 'Structure', rows: [
      ['bloomGain', 'Core glow', 0.15, 1.2, 0.01],
      ['spikeGain', 'Prong punch', 0.6, 2, 0.01],
      ['moteGain', 'Mote sparkle', 0.5, 2, 0.01],
    ] },
  ];

  const paramAt = (key: string): number => (sky as unknown as Record<string, number>)[key] ?? 0;
  const setParam = (key: string, value: number): void => {
    (sky as unknown as Record<string, number>)[key] = value;
    if (key === 'clusters' || key === 'corridor' || key === 'minGap') placeArtists();
  };

  const refreshHud = (): void => {
    for (const [key, input] of sliders) {
      const v = paramAt(key);
      if (document.activeElement !== input) input.value = String(v);
    }
    for (const [key, el] of readouts) el.textContent = paramAt(key).toFixed(2);
  };

  const buildHud = (): void => {
    const presetRow = document.createElement('div');
    presetRow.className = 'lab-variants';
    ([['1', 14], ['2', 40], ['3', 120]] as [string, number][]).forEach(([label, count]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.title = count + ' artists';
      btn.addEventListener('click', () => setRoster(count));
      presetRow.append(btn);
    });
    hud.append(presetRow);
    for (const group of GROUPS) {
      const h = document.createElement('div');
      h.className = 'lab-group-title';
      h.textContent = group.title;
      hud.append(h);
      for (const [key, label, min, max, step] of group.rows) {
        const row = document.createElement('div');
        row.className = 'lab-row';
        const name = document.createElement('span');
        name.className = 'lab-label';
        name.textContent = label;
        const val = document.createElement('span');
        val.className = 'lab-val mono';
        readouts.set(key, val);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        sliders.set(key, input);
        input.addEventListener('input', () => {
          setParam(key, Number(input.value));
          val.textContent = Number(input.value).toFixed(2);
          dirty = true;
          save();
        });
        row.append(name, val, input);
        hud.append(row);
      }
    }
    const hint = document.createElement('div');
    hint.className = 'lab-hint mono';
    hint.textContent = '1/2/3 roster · H panel · wheel zoom · drag pan';
    hud.append(hint);
    refreshHud();
  };

  const setRoster = (count: number): void => {
    sky.roster = count;
    buildClusters();
    buildRoster();
    refreshHud();
    save();
    dirty = true;
  };

  window.addEventListener('resize', () => {
    resize();
    dirty = true;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0011);
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    if (next === zoom) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = -(e.clientY - rect.top - rect.height / 2);
    const kOld = 1 / (BASE_PX * zoom);
    zoom = next;
    const kNew = 1 / (BASE_PX * zoom);
    camX += cx * (kOld - kNew);
    camY += cy * (kOld - kNew);
    dirty = true;
  }, { passive: false });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - lastX) / (BASE_PX * zoom);
    const dy = -(e.clientY - lastY) / (BASE_PX * zoom);
    lastX = e.clientX;
    lastY = e.clientY;
    camX -= dx;
    camY -= dy;
    dirty = true;
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === '1') setRoster(14);
    else if (e.key === '2') setRoster(40);
    else if (e.key === '3') setRoster(120);
    else if (e.key === 'h' || e.key === 'H') hud.classList.toggle('hidden');
  });

  buildHud();
  resize();
  buildClusters();
  buildRoster();

  const labRecord: Record<string, unknown> = {
    ok: true,
    population: artists.length,
    preset: Math.round(sky.roster),
    zoom,
    resetView: () => {
      zoom = 1;
      camX = WORLD_W / 2;
      camY = WORLD_H / 2;
      dirty = true;
      labRecord['zoom'] = zoom;
    },
    setZoom: (z: number) => {
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
      dirty = true;
      labRecord['zoom'] = zoom;
    },
    setParam: (key: string, value: number) => {
      setParam(key, value);
      refreshHud();
      dirty = true;
    },
    setPreset: (n: number) => {
      setRoster(n);
    },
    focusLargest: () => {
      let best: Artist | null = null;
      for (const a of artists) if (!best || a.bodyScale > best.bodyScale) best = a;
      if (best) {
        camX = best.x;
        camY = best.y;
        dirty = true;
      }
    },
    positions: () => {
      const rect = canvas.getBoundingClientRect();
      const ppuCss = BASE_PX * zoom;
      return artists.map((a) => ({
        x: Math.round(rect.width / 2 + (a.x - camX) * ppuCss),
        y: Math.round(rect.height / 2 - (a.y - camY) * ppuCss),
        body: a.bodyScale,
        name: a.name,
      }));
    },
    metrics: () => {
      const rect = canvas.getBoundingClientRect();
      const ppuCss = BASE_PX * zoom;
      let best: Artist | null = null;
      for (const a of artists) if (!best || a.bodyScale > best.bodyScale) best = a;
      return {
        x: rect.width / 2 + ((best ? best.x : 0) - camX) * ppuCss,
        y: rect.height / 2 - ((best ? best.y : 0) - camY) * ppuCss,
        bodyPx: (best ? best.bodyScale : 0.5) * ppuCss,
        zoom,
        camX,
        camY,
      };
    },
    dump: () => JSON.stringify(sky),
  };
  (window as unknown as Record<string, unknown>).__lab = labRecord;

  let lastT = 0;
  const frame = (tms: number): void => {
    const t = tms * 0.001;
    const dt = Math.min(0.1, t - lastT);
    lastT = t;
    driftAngle += dt * 0.18;
    draw(t);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
