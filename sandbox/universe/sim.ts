import '@fontsource/sora/300.css';
import '@fontsource/ibm-plex-mono/400.css';
import './sim.css';
import { createRenderer, type Renderer } from './gl';
import { STAR_FRAG, STAR_VERT } from './starShaders';

type Recipe = {
  exposure: number;
  hue: number;
  heat: number;
  bloomShift: number;
  heartShift: number;
  heartMix: number;
  coreScale: number;
  bodyScale: number;
  bodyMode: number;
  rim: number;
  bloomRadius: [number, number, number];
  bloomGain: [number, number, number];
  prongs: number;
  spikeLength: number;
  spikeWidth: number;
  spikeGain: number;
  spikeAngle: number;
  disperse: number;
  facetGain: number;
  sparkles: number;
  sparkleGain: number;
  sparkleSize: number;
  shimmer: number;
  flicker: number;
  drift: number;
  fieldDensity: number;
  fieldGain: number;
};

const BASE_PX = 150;
const MAX_SPARKLES = 28;
const MAX_PRONGS = 12;
const ZOOM_MIN = 0.06;
const ZOOM_MAX = 60;
const STORE_KEY = 'universe-lab-v5';
const RECIPE_SCHEMA = 5;

const VARIANTS: { name: string; recipe: Recipe }[] = [
  {
    name: 'crystal',
    recipe: {
      exposure: 1.5, hue: 208, heat: 0.6, bloomShift: -14, heartShift: 34, heartMix: 0.65,
      coreScale: 0.22, bodyScale: 0.75, bodyMode: 2, rim: 0.55,
      bloomRadius: [1.9, 1.9, 5.5], bloomGain: [0.4, 0.06, 0.007],
      prongs: 10, spikeLength: 3.6, spikeWidth: 1.3, spikeGain: 0.4, spikeAngle: 0, disperse: 0.7,
      facetGain: 0.3, sparkles: 14, sparkleGain: 0.65, sparkleSize: 1.9, shimmer: 0, flicker: 0, drift: 0,
      fieldDensity: 0.5, fieldGain: 0.8,
    },
  },
  {
    name: 'nova',
    recipe: {
      exposure: 1.5, hue: 40, heat: 0.75, bloomShift: -8, heartShift: -18, heartMix: 0.45,
      coreScale: 0.26, bodyScale: 0.8, bodyMode: 0, rim: 0.3,
      bloomRadius: [1.7, 1.8, 5], bloomGain: [0.5, 0.09, 0.01],
      prongs: 8, spikeLength: 3.4, spikeWidth: 1.5, spikeGain: 0.3, spikeAngle: 0, disperse: 0.3,
      facetGain: 0.1, sparkles: 9, sparkleGain: 0.4, sparkleSize: 2.3, shimmer: 0, flicker: 0, drift: 0,
      fieldDensity: 0.45, fieldGain: 0.7,
    },
  },
  {
    name: 'ember',
    recipe: {
      exposure: 1.4, hue: 16, heat: 0.35, bloomShift: 6, heartShift: -40, heartMix: 0.55,
      coreScale: 0.2, bodyScale: 0.78, bodyMode: 2, rim: 1.0,
      bloomRadius: [1.6, 1.8, 5], bloomGain: [0.45, 0.09, 0.011],
      prongs: 12, spikeLength: 3.6, spikeWidth: 1.6, spikeGain: 0.45, spikeAngle: 0, disperse: 0.5,
      facetGain: 0.25, sparkles: 10, sparkleGain: 0.5, sparkleSize: 2.2, shimmer: 0, flicker: 0, drift: 0,
      fieldDensity: 0.4, fieldGain: 0.6,
    },
  },
];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const rgb = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [rgb[0]! + m, rgb[1]! + m, rgb[2]! + m];
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

  const rand = mulberry32(1337);
  const jitter = Array.from({ length: MAX_SPARKLES }, () => [rand(), rand(), rand(), rand(), rand(), rand(), rand()] as const);
  const prongRand = mulberry32(4242);
  const prongData = new Float32Array(MAX_PRONGS * 4);
  for (let i = 0; i < MAX_PRONGS; i++) {
    const angle = (i / MAX_PRONGS) * Math.PI * 2 + (prongRand() - 0.5) * 0.35;
    const lenFactor = i < 2 ? 0.85 + 0.15 * prongRand() : 0.3 + 0.55 * Math.pow(prongRand(), 1.4);
    const widthFactor = 0.75 + 0.6 * prongRand();
    const gainFactor = 0.55 + 0.45 * prongRand();
    prongData[i * 4] = angle;
    prongData[i * 4 + 1] = lenFactor;
    prongData[i * 4 + 2] = widthFactor;
    prongData[i * 4 + 3] = gainFactor;
  }

  const saved = (() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const parsed = raw ? (JSON.parse(raw) as { schema?: number; variant?: number; recipe?: Partial<Recipe> }) : null;
      return parsed && parsed.schema === RECIPE_SCHEMA ? parsed : null;
    } catch {
      return null;
    }
  })();

  let variantIndex = saved?.variant !== undefined && VARIANTS[saved.variant] ? saved.variant : 0;
  let recipe: Recipe = {
    ...structuredClone(VARIANTS[variantIndex]!.recipe),
    ...(saved?.recipe ?? {}),
  };

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let zoom = 1;
  let camX = 0;
  let camY = 0;
  let driftAngle = 0;
  let dirty = true;
  const hueCache = {
    hue: -1, shift: -999, heartShift: -999, heat: -1,
    core: [0, 0, 0] as [number, number, number],
    body: [0, 0, 0] as [number, number, number],
    bloom: [0, 0, 0] as [number, number, number],
    heart: [0, 0, 0] as [number, number, number],
    rim: [0, 0, 0] as [number, number, number],
    sparkA: [0, 0, 0] as [number, number, number],
    sparkB: [0, 0, 0] as [number, number, number],
  };

  const pxPerUnitDevice = (): number => BASE_PX * dpr * zoom;
  const bodyPxDevice = (): number => recipe.bodyScale * pxPerUnitDevice();

  const sparkleData = new Float32Array(MAX_SPARKLES * 4);
  const sparkleMeta = new Float32Array(MAX_SPARKLES * 4);
  const layoutSparkles = (): void => {
    const ring = bodyPxDevice();
    for (let i = 0; i < MAX_SPARKLES; i++) {
      const j = jitter[i]!;
      const band = 1.45 + 2.5 * j[0]!;
      const theta = j[1]! * Math.PI * 2 + band * 2.4 + driftAngle * (0.4 + j[2]! * 0.8);
      const size = recipe.sparkleSize * dpr * (0.7 + 0.6 * j[3]!);
      sparkleData[i * 4] = Math.cos(theta) * band * ring;
      sparkleData[i * 4 + 1] = Math.sin(theta) * band * ring;
      sparkleData[i * 4 + 2] = size;
      sparkleData[i * 4 + 3] = j[4]!;
      sparkleMeta[i * 4] = j[5]!;
      sparkleMeta[i * 4 + 1] = j[6]!;
      sparkleMeta[i * 4 + 2] = j[1]!;
      sparkleMeta[i * 4 + 3] = 0;
    }
  };

  const colors = (): void => {
    if (hueCache.hue === recipe.hue && hueCache.shift === recipe.bloomShift && hueCache.heartShift === recipe.heartShift && hueCache.heat === recipe.heat) return;
    const body = hslToRgb(recipe.hue, 0.66, 0.6);
    const k = 0.75 + recipe.heat * 0.2;
    const core: [number, number, number] = [body[0] + (1 - body[0]) * k, body[1] + (1 - body[1]) * k, body[2] + (1 - body[2]) * k];
    const bloom = hslToRgb(recipe.hue + recipe.bloomShift, 0.74, 0.55);
    const heart = hslToRgb(recipe.hue + recipe.heartShift, 0.8, 0.62);
    const rim = hslToRgb(recipe.hue + recipe.heartShift * 0.6 + 16, 0.85, 0.72);
    const sparkA = hslToRgb(recipe.hue - 22, 0.75, 0.72);
    const sparkB = hslToRgb(recipe.hue + 30, 0.75, 0.74);
    hueCache.hue = recipe.hue;
    hueCache.shift = recipe.bloomShift;
    hueCache.heartShift = recipe.heartShift;
    hueCache.heat = recipe.heat;
    hueCache.core = core;
    hueCache.body = body;
    hueCache.bloom = bloom;
    hueCache.heart = heart;
    hueCache.rim = rim;
    hueCache.sparkA = sparkA;
    hueCache.sparkB = sparkB;
  };

  const resize = (): void => {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    layoutSparkles();
    dirty = true;
  };

  const draw = (time: number): void => {
    colors();
    r.setV2('uResolution', canvas.width, canvas.height);
    r.setF('uTime', time);
    r.setV2('uCam', camX, camY);
    r.setF('uPxPerUnit', pxPerUnitDevice());
    r.setF('uDpr', dpr);
    r.setF('uExposure', recipe.exposure);
    r.setV3('uColorCore', hueCache.core[0], hueCache.core[1], hueCache.core[2]);
    r.setV3('uColorBody', hueCache.body[0], hueCache.body[1], hueCache.body[2]);
    r.setV3('uColorBloom', hueCache.bloom[0], hueCache.bloom[1], hueCache.bloom[2]);
    r.setV3('uColorHeart', hueCache.heart[0], hueCache.heart[1], hueCache.heart[2]);
    r.setV3('uColorRim', hueCache.rim[0], hueCache.rim[1], hueCache.rim[2]);
    r.setV3('uSparkA', hueCache.sparkA[0], hueCache.sparkA[1], hueCache.sparkA[2]);
    r.setV3('uSparkB', hueCache.sparkB[0], hueCache.sparkB[1], hueCache.sparkB[2]);
    r.setF('uCoreRadius', recipe.coreScale);
    r.setF('uBodyRadius', recipe.bodyScale);
    r.setF('uBodyMode', recipe.bodyMode);
    r.setF('uRim', recipe.rim);
    r.setF('uHeartMix', recipe.heartMix);
    r.setV3('uBloomRadius', recipe.bloomRadius[0], recipe.bloomRadius[1], recipe.bloomRadius[2]);
    r.setV3('uBloomGain', recipe.bloomGain[0], recipe.bloomGain[1], recipe.bloomGain[2]);
    r.setF('uSpikeLength', recipe.spikeLength);
    r.setF('uSpikeWidth', recipe.spikeWidth);
    r.setF('uSpikeGain', recipe.spikeGain);
    r.setF('uSpikeAngle', (recipe.spikeAngle * Math.PI) / 180);
    r.setF('uDisperse', recipe.disperse);
    r.setF('uFacetGain', recipe.facetGain);
    r.setI('uProngCount', Math.round(recipe.prongs));
    r.setV4Array('uProngs', prongData);
    r.setI('uSparkleCount', Math.round(recipe.sparkles));
    r.setV4Array('uSparkles', sparkleData);
    r.setV4Array('uSparkMeta', sparkleMeta);
    r.setF('uSparkleGain', recipe.sparkleGain);
    r.setF('uSparkleSize', recipe.sparkleSize);
    r.setF('uShimmer', recipe.shimmer);
    r.setF('uFlicker', recipe.flicker);
    r.setF('uFieldDensity', recipe.fieldDensity);
    r.setF('uFieldGain', recipe.fieldGain);
    r.draw();
  };

  const save = (): void => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ schema: RECIPE_SCHEMA, variant: variantIndex, recipe }));
    } catch {}
  };

  const hud = document.createElement('div');
  hud.id = 'lab-hud';
  hud.className = 'hidden';
  stage.append(hud);
  const sliders = new Map<string, HTMLInputElement>();
  const readouts = new Map<string, HTMLElement>();

  const GROUPS: { title: string; rows: [string, string, number, number, number][] }[] = [
    { title: 'Light', rows: [
      ['exposure', 'Exposure', 0.4, 3, 0.01],
      ['hue', 'Hue', 0, 360, 1],
      ['heat', 'Core heat', 0, 1, 0.01],
      ['bloomShift', 'Bloom hue shift', -60, 60, 1],
      ['heartShift', 'Heart hue shift', -60, 60, 1],
      ['heartMix', 'Heart mix', 0, 1, 0.01],
    ] },
    { title: 'Body', rows: [
      ['bodyMode', 'Body mode', 0, 2, 0.01],
      ['coreScale', 'Core radius', 0.05, 0.5, 0.005],
      ['bodyScale', 'Body radius', 0.4, 2, 0.01],
      ['rim', 'Rim light', 0, 1, 0.01],
    ] },
    { title: 'Bloom', rows: [
      ['bloomRadius.0', 'Inner radius', 0.5, 14, 0.05],
      ['bloomGain.0', 'Inner gain', 0, 2, 0.01],
      ['bloomRadius.1', 'Mid radius', 0.5, 14, 0.05],
      ['bloomGain.1', 'Mid gain', 0, 2, 0.01],
      ['bloomRadius.2', 'Halo radius', 0.5, 14, 0.05],
      ['bloomGain.2', 'Halo gain', 0, 2, 0.01],
    ] },
    { title: 'Prongs', rows: [
      ['prongs', 'Prong count', 0, 12, 1],
      ['spikeLength', 'Prong length', 0, 8, 0.05],
      ['spikeWidth', 'Prong softness', 0.5, 3, 0.01],
      ['spikeGain', 'Prong gain', 0, 2, 0.01],
      ['spikeAngle', 'Prong rotation', 0, 90, 0.5],
      ['disperse', 'Prismatic drift', 0, 1, 0.01],
    ] },
    { title: 'Diamond dust', rows: [
      ['facetGain', 'Facet structure', 0, 1, 0.01],
      ['sparkles', 'Dust count', 0, 24, 1],
      ['sparkleGain', 'Dust gain', 0, 1.2, 0.01],
      ['sparkleSize', 'Dust size', 1, 4, 0.05],
      ['shimmer', 'Shimmer', 0, 1, 0.01],
      ['flicker', 'Flicker', 0, 1, 0.01],
      ['drift', 'Drift', 0, 1, 0.01],
    ] },
    { title: 'Field', rows: [
      ['fieldDensity', 'Field density', 0, 1, 0.01],
      ['fieldGain', 'Field gain', 0, 1.6, 0.01],
    ] },
  ];

  const paramAt = (key: string): number => {
    const [k, idx] = key.split('.');
    const base = recipe[k as keyof Recipe];
    if (idx !== undefined && Array.isArray(base)) return base[Number(idx)] ?? 0;
    return typeof base === 'number' ? base : 0;
  };
  const setParam = (key: string, value: number): void => {
    const [k, idx] = key.split('.');
    const base = recipe[k as keyof Recipe];
    if (idx !== undefined && Array.isArray(base)) base[Number(idx)] = value;
    else if (typeof base === 'number') (recipe as unknown as Record<string, number>)[k!] = value;
    if (k === 'bodyScale' || k === 'sparkleSize') layoutSparkles();
  };

  const refreshHud = (): void => {
    for (const [key, input] of sliders) {
      const v = paramAt(key);
      if (document.activeElement !== input) input.value = String(v);
    }
    for (const [key, el] of readouts) el.textContent = paramAt(key).toFixed(2);
  };

  const buildHud = (): void => {
    const variantRow = document.createElement('div');
    variantRow.className = 'lab-variants';
    VARIANTS.forEach((v, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = String(i + 1);
      btn.title = v.name;
      btn.addEventListener('click', () => applyVariant(i));
      variantRow.append(btn);
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'reset';
    reset.className = 'lab-reset';
    reset.addEventListener('click', () => applyVariant(variantIndex));
    variantRow.append(reset);
    hud.append(variantRow);
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
    hint.textContent = 'B body · H panel · P recipe · wheel zoom · drag parallax';
    hud.append(hint);
    refreshHud();
  };

  const applyVariant = (index: number): void => {
    variantIndex = index;
    recipe = structuredClone(VARIANTS[index]!.recipe);
    layoutSparkles();
    refreshHud();
    dirty = true;
    save();
  };

  const dumpRecipe = (): void => {
    const json = JSON.stringify({ variant: VARIANTS[variantIndex]!.name, recipe }, null, 2);
    console.log(json);
    try {
      void navigator.clipboard.writeText(json);
    } catch {}
  };

  window.addEventListener('resize', resize);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0011);
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    if (next === zoom) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = -(e.clientY - rect.top - rect.height / 2);
    const kOld = 1 / pxPerUnitDevice() * dpr;
    zoom = next;
    const kNew = 1 / pxPerUnitDevice() * dpr;
    camX += cx * (kOld - kNew);
    camY += cy * (kOld - kNew);
    layoutSparkles();
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
    camX = Math.max(-8, Math.min(8, camX));
    camY = Math.max(-8, Math.min(8, camY));
    dirty = true;
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === '1') applyVariant(0);
    else if (e.key === '2') applyVariant(1);
    else if (e.key === '3') applyVariant(2);
    else if (e.key === 'b' || e.key === 'B') {
      setParam('bodyMode', (Math.round(paramAt('bodyMode')) + 1) % 3);
      refreshHud();
      dirty = true;
      save();
    } else if (e.key === 'h' || e.key === 'H') hud.classList.toggle('hidden');
    else if (e.key === 'p' || e.key === 'P') dumpRecipe();
  });

  buildHud();
  resize();

  const labRecord: Record<string, unknown> = {
    ok: true,
    variant: VARIANTS[variantIndex]!.name,
    zoom,
    resetView: () => {
      zoom = 1;
      camX = 0;
      camY = 0;
      layoutSparkles();
      dirty = true;
      labRecord['zoom'] = zoom;
    },
    setZoom: (z: number) => {
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
      layoutSparkles();
      dirty = true;
      labRecord['zoom'] = zoom;
    },
    setParam: (key: string, value: number) => {
      setParam(key, value);
      refreshHud();
      dirty = true;
    },
    metrics: () => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.width / 2 - camX * BASE_PX * zoom,
        y: rect.height / 2 + camY * BASE_PX * zoom,
        bodyPx: recipe.bodyScale * BASE_PX * zoom,
        zoom,
      };
    },
    dump: () => JSON.stringify({ variant: VARIANTS[variantIndex]!.name, recipe }),
  };
  (window as unknown as Record<string, unknown>).__lab = labRecord;

  let lastT = 0;
  const frame = (tms: number): void => {
    const t = tms * 0.001;
    const dt = Math.min(0.1, t - lastT);
    lastT = t;
    if (recipe.drift > 0.001) {
      driftAngle += dt * recipe.drift * 0.25;
      layoutSparkles();
    }
    if (dirty || recipe.shimmer > 0.001 || recipe.flicker > 0.001) draw(t);
    dirty = false;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
