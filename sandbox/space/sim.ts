import '@fontsource/sora/300.css';
import '@fontsource/ibm-plex-mono/400.css';
import './space.css';
import { createRenderer, type Renderer } from './gl';
import { SPACE_FRAG, SPACE_VERT } from './spaceShaders';

type V3 = { x: number; y: number; z: number };
type RGB = [number, number, number];

type Look = {
  tilt: number;
  glow: number;
  spike: number;
  motes: number;
  moteSpeed: number;
};

type Star = {
  name: string;
  hash: number;
  mass: number;
  hue: number;
  sat: number;
  motes: number;
  spikeVar: number;
  cols: { core: RGB; body: RGB; heart: RGB; bloom: RGB; rim: RGB };
  x: number;
  y: number;
  z: number;
  orbitU: Float32Array;
  orbitV: Float32Array;
  moteR: Float32Array;
  motePhase: Float32Array;
  moteSpeed: Float32Array;
  moteSize: Float32Array;
  moteMix: Float32Array;
  moteSpiky: Float32Array;
};

const MAX_MOTES = 14;
const FOV = (50 * Math.PI) / 180;
const DIST_MIN = 9;
const DIST_MAX = 420;
const OVAL_IN = 20;
const OVAL_OUT = 95;
const STORE_KEY = 'space-lab-v1';
const SCHEMA = 1;

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

function normalize3(v: V3): V3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function cross3(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

const boot = (): void => {
  const stage = document.querySelector('#stage');
  if (!(stage instanceof HTMLElement)) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'space-canvas';
  stage.append(canvas);

  const result = createRenderer(canvas, SPACE_VERT, SPACE_FRAG);
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
      const parsed = raw ? (JSON.parse(raw) as { schema?: number; look?: Partial<Look> }) : null;
      return parsed && parsed.schema === SCHEMA ? parsed : null;
    } catch {
      return null;
    }
  })();

  const look: Look = {
    tilt: 42,
    glow: 1,
    spike: 1,
    motes: 1,
    moteSpeed: 1,
    ...(saved?.look ?? {}),
  };

  let presetCount = 40;
  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let targetX = 0;
  let targetZ = 0;
  let dist = 150;
  const glErrors: string[] = [];

  let stars: Star[] = [];

  const placeInOval = (s: Star, pr: () => number): void => {
    let x = 0;
    let z = 0;
    for (let t = 0; t < 24; t++) {
      const th = pr() * Math.PI * 2;
      const rIn = OVAL_IN * (1 + 0.28 * Math.sin(th * 3 + 1.7) + 0.1 * Math.sin(th * 7 + 0.4));
      const rOut = OVAL_OUT * (1 + 0.18 * Math.sin(th * 2 + 4.1) + 0.08 * Math.sin(th * 5 + 2.2));
      const rr = rIn + (rOut - rIn) * Math.sqrt(pr());
      const clump = 0.5 + 0.5 * Math.sin(th * 4 + 0.9) * Math.sin(th * 2 + 2.3);
      const accepted = t >= 23 || pr() <= 0.3 + 0.55 * clump;
      if (!accepted) continue;
      x = Math.cos(th) * rr * 1.45 + (pr() - 0.5) * 6;
      z = Math.sin(th) * rr * 0.95 + (pr() - 0.5) * 6;
      break;
    }
    s.x = x;
    s.z = z;
    s.y = (pr() - 0.5) * 3;
  };

  const buildRoster = (): void => {
    const pr = mulberry32(20260908);
    const raw: Star[] = [];
    for (let i = 0; i < presetCount; i++) {
      const name = makeName(pr);
      const hash = hashName(name);
      const ph = mulberry32(hash);
      const massRank = Math.pow(pr(), 2.2);
      const star: Star = {
        name,
        hash,
        mass: 0.45 + massRank * 1.15,
        hue: [20, 45, 200, 262, 330][Math.floor(ph() * 5) % 5]! + (ph() - 0.5) * 24,
        sat: 0.34 + ph() * 0.24,
        motes: 6 + Math.floor(ph() * 6),
        spikeVar: 2.3 + ph() * 1.0,
        cols: { core: [0, 0, 0], body: [0, 0, 0], heart: [0, 0, 0], bloom: [0, 0, 0], rim: [0, 0, 0] },
        x: 0,
        y: 0,
        z: 0,
        orbitU: new Float32Array(MAX_MOTES * 3),
        orbitV: new Float32Array(MAX_MOTES * 3),
        moteR: new Float32Array(MAX_MOTES),
        motePhase: new Float32Array(MAX_MOTES),
        moteSpeed: new Float32Array(MAX_MOTES),
        moteSize: new Float32Array(MAX_MOTES),
        moteMix: new Float32Array(MAX_MOTES),
        moteSpiky: new Float32Array(MAX_MOTES),
      };
      const body = hslToRgb(star.hue, star.sat, 0.62);
      star.cols.body = body;
      star.cols.core = mix3(body, [1, 1, 1], 0.85);
      star.cols.heart = hslToRgb(star.hue + 30, 0.8, 0.62);
      star.cols.bloom = hslToRgb(star.hue - 10, 0.5, 0.6);
      star.cols.rim = hslToRgb(star.hue + 26, 0.6, 0.74);
      const ds = mulberry32(star.hash ^ 0x7e3b);
      let spikyCount = 0;
      for (let m = 0; m < MAX_MOTES; m++) {
        if (m >= star.motes) break;
        const n = normalize3({ x: ds() * 2 - 1, y: Math.max(0.15, ds() * 0.8 + 0.1), z: ds() * 2 - 1 });
        const helper = Math.abs(n.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
        const u = normalize3(cross3(n, helper));
        const v = cross3(n, u);
        star.orbitU[m * 3] = u.x;
        star.orbitU[m * 3 + 1] = u.y;
        star.orbitU[m * 3 + 2] = u.z;
        star.orbitV[m * 3] = v.x;
        star.orbitV[m * 3 + 1] = v.y;
        star.orbitV[m * 3 + 2] = v.z;
        star.moteR[m] = star.mass * (1.4 + 1.5 * ds());
        star.motePhase[m] = ds() * Math.PI * 2;
        star.moteSpeed[m] = (0.02 + ds() * 0.06) * (ds() < 0.5 ? -1 : 1);
        star.moteSize[m] = 0.1 + ds() * 0.12;
        star.moteMix[m] = ds();
        if (ds() < 0.25 && spikyCount < 2) {
          star.moteSpiky[m] = 1;
          spikyCount++;
        }
      }
      raw.push(star);
    }
    raw.sort((a, b) => b.mass - a.mass);
    for (const s of raw) placeInOval(s, pr);
    stars = raw;
  };

  const camPos = (): V3 => {
    const p = (look.tilt * Math.PI) / 180;
    return { x: targetX, y: Math.sin(p) * dist, z: targetZ + Math.cos(p) * dist };
  };

  const camBasis = (): { fwd: V3; right: V3; up: V3 } => {
    const p = (look.tilt * Math.PI) / 180;
    const fwd = normalize3({ x: 0, y: -Math.sin(p), z: -Math.cos(p) });
    const right = normalize3(cross3(fwd, { x: 0, y: 1, z: 0 }));
    const up = cross3(right, fwd);
    return { fwd, right, up };
  };

  type Basis = { fwd: V3; right: V3; up: V3 };

  const project = (p: V3, cp: V3, basis: Basis): { x: number; y: number; depth: number; scale: number; behind: boolean } => {
    const rx = p.x - cp.x;
    const ry = p.y - cp.y;
    const rz = p.z - cp.z;
    const depth = rx * basis.fwd.x + ry * basis.fwd.y + rz * basis.fwd.z;
    const x = rx * basis.right.x + ry * basis.right.y + rz * basis.right.z;
    const y = rx * basis.up.x + ry * basis.up.y + rz * basis.up.z;
    const scale = depth > 0.5 ? canvas.height / 2 / (Math.tan(FOV / 2) * depth) : 0;
    return {
      x: canvas.width / 2 + x * scale,
      y: canvas.height / 2 - y * scale,
      depth,
      scale,
      behind: depth <= 0.5,
    };
  };

  const rayDir = (px: number, py: number, basis: Basis): V3 => {
    const ndcX = (px / canvas.width) * 2 - 1;
    const ndcY = ((canvas.height - py) / canvas.height) * 2 - 1;
    const t = Math.tan(FOV / 2);
    const ax = ndcX * t * (canvas.width / canvas.height);
    const ay = ndcY * t;
    return normalize3({
      x: basis.fwd.x + basis.right.x * ax + basis.up.x * ay,
      y: basis.fwd.y + basis.right.y * ax + basis.up.y * ay,
      z: basis.fwd.z + basis.right.z * ax + basis.up.z * ay,
    });
  };

  const moteScratch = new Float32Array(MAX_MOTES * 4);
  const metaScratch = new Float32Array(MAX_MOTES * 4);

  const draw = (time: number): void => {
    const cp = camPos();
    const basis = camBasis();
    const tanF = Math.tan(FOV / 2);
    const aspect = canvas.width / canvas.height;

    r.setBlend(false);
    r.setViewport(0, 0, canvas.width, canvas.height);
    r.setV2('uResolution', canvas.width, canvas.height);
    r.setV2('uCanvas', canvas.width, canvas.height);
    r.setV2('uViewOrigin', 0, 0);
    r.setF('uTime', time);
    r.setF('uDpr', dpr);
    r.setF('uExposure', 1.5);
    r.setF('uStarGain', 0);
    r.setF('uVoidGain', 1);
    r.setF('uFieldDensity', 0.5);
    r.setF('uFieldGain', 0.8);
    r.setV2('uDustOffset', targetX * 4 * dpr, targetZ * 4 * dpr);
    r.drawFullscreen();

    r.setBlend(true);
    r.setF('uFieldDensity', 0);
    r.setF('uFieldGain', 0);
    for (const s of stars) {
      const c = project({ x: s.x, y: s.y, z: s.z }, cp, basis);
      if (c.behind) continue;
      const radPx = s.mass * c.scale;
      if (radPx < 0.6) continue;
      const reach = radPx * (2.6 + s.spikeVar * look.spike) + 40 * dpr;
      if (c.x + reach < 0 || c.x - reach > canvas.width || c.y + reach < 0 || c.y - reach > canvas.height) continue;
      const vx = Math.max(0, Math.floor(c.x - reach));
      const vy = Math.max(0, Math.floor(canvas.height - c.y - reach));
      const vw = Math.min(canvas.width, Math.ceil(c.x + reach)) - vx;
      const vh = Math.min(canvas.height, Math.ceil(canvas.height - (c.y - reach))) - vy;
      if (vw <= 0 || vh <= 0) continue;

      let moteCount = 0;
      const tox = s.x - cp.x;
      const toy = s.y - cp.y;
      const toz = s.z - cp.z;
      for (let i = 0; i < s.motes; i++) {
        const ang = s.motePhase[i] + s.moteSpeed[i] * look.moteSpeed * time;
        const ca = Math.cos(ang) * s.moteR[i];
        const sa = Math.sin(ang) * s.moteR[i];
        const pos = {
          x: s.x + s.orbitU[i * 3] * ca + s.orbitV[i * 3] * sa,
          y: s.y + s.orbitU[i * 3 + 1] * ca + s.orbitV[i * 3 + 1] * sa,
          z: s.z + s.orbitU[i * 3 + 2] * ca + s.orbitV[i * 3 + 2] * sa,
        };
        const mp = project(pos, cp, basis);
        if (mp.behind) continue;
        const rel = { x: pos.x - cp.x, y: pos.y - cp.y, z: pos.z - cp.z };
        const relLen = Math.hypot(rel.x, rel.y, rel.z);
        const toCLen = Math.hypot(tox, toy, toz);
        const tClosest = ((rel.x * tox + rel.y * toy + rel.z * toz) / (relLen * toCLen || 1)) * relLen;
        if (tClosest > 0 && tClosest < relLen) {
          const dx2 = (rel.x / relLen) * tClosest - tox;
          const dy2 = (rel.y / relLen) * tClosest - toy;
          const dz2 = (rel.z / relLen) * tClosest - toz;
          if (Math.hypot(dx2, dy2, dz2) < s.mass) continue;
        }
        moteScratch[moteCount * 4] = mp.x;
        moteScratch[moteCount * 4 + 1] = canvas.height - mp.y;
        moteScratch[moteCount * 4 + 2] = Math.max(1.2, s.moteSize[i] * mp.scale);
        moteScratch[moteCount * 4 + 3] = s.motePhase[i];
        metaScratch[moteCount * 4] = s.moteSpiky[i];
        metaScratch[moteCount * 4 + 1] = s.moteMix[i];
        metaScratch[moteCount * 4 + 2] = 0;
        metaScratch[moteCount * 4 + 3] = 0;
        moteCount++;
      }

      r.setViewport(vx, vy, vw, vh);
      r.setV2('uResolution', vw, vh);
      r.setV2('uCanvas', canvas.width, canvas.height);
      r.setV2('uViewOrigin', vx, vy);
      r.setV2('uCenter', c.x, canvas.height - c.y);
      r.setF('uRadius', radPx);
      r.setF('uStarGain', 1);
      r.setF('uVoidGain', 0);
      r.setV3('uCamPos', cp.x, cp.y, cp.z);
      r.setV3('uCamRight', basis.right.x, basis.right.y, basis.right.z);
      r.setV3('uCamUp', basis.up.x, basis.up.y, basis.up.z);
      r.setV3('uCamForward', basis.fwd.x, basis.fwd.y, basis.fwd.z);
      r.setF('uTanHalfFov', tanF);
      r.setF('uAspect', aspect);
      r.setV3('uSphereCenter', s.x, s.y, s.z);
      r.setF('uSphereRadius', s.mass);
      r.setV3('uColorCore', s.cols.core[0], s.cols.core[1], s.cols.core[2]);
      r.setV3('uColorBody', s.cols.body[0], s.cols.body[1], s.cols.body[2]);
      r.setV3('uColorHeart', s.cols.heart[0], s.cols.heart[1], s.cols.heart[2]);
      r.setV3('uColorBloom', s.cols.bloom[0], s.cols.bloom[1], s.cols.bloom[2]);
      r.setV3('uColorRim', s.cols.rim[0], s.cols.rim[1], s.cols.rim[2]);
      r.setF('uSpikeIntensity', 0.5 * look.spike * (0.7 + Math.min(1, s.mass / 1.6) * 0.6));
      r.setF('uSpikeLength', s.spikeVar);
      r.setF('uGlowGain', 0.22 * look.glow * (0.6 + Math.min(1, s.mass / 1.6) * 0.6));
      r.setI('uMoteCount', moteCount);
      r.setV4Array('uMotes', moteScratch);
      r.setV4Array('uMoteMeta', metaScratch);
      r.setF('uMoteGain', 0.6 * look.motes);
      r.setF('uShimmer', 0.18);
      r.drawFullscreen();
      const e = r.gl.getError();
      if (e !== 0 && glErrors.length < 6) glErrors.push('GL err ' + s.name + ': ' + e);
    }
    r.setBlend(false);
  };

  const resize = (): void => {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  };

  const save = (): void => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ schema: SCHEMA, look }));
    } catch {}
  };

  const hud = document.createElement('div');
  hud.id = 'lab-hud';
  hud.className = 'hidden';
  stage.append(hud);
  const sliders = new Map<string, HTMLInputElement>();
  const readouts = new Map<string, HTMLElement>();

  const GROUPS: { title: string; rows: [string, string, number, number, number][] }[] = [
    { title: 'Camera', rows: [
      ['tilt', 'Tilt', 20, 70, 1],
    ] },
    { title: 'Look', rows: [
      ['glow', 'Glow', 0, 2, 0.01],
      ['spike', 'Spikes', 0, 2, 0.01],
      ['motes', 'Motes', 0, 2, 0.01],
      ['moteSpeed', 'Orbit speed', 0, 3, 0.01],
    ] },
  ];

  const paramAt = (key: string): number => (look as unknown as Record<string, number>)[key] ?? 0;
  const setParam = (key: string, value: number): void => {
    (look as unknown as Record<string, number>)[key] = value;
  };

  const refreshHud = (): void => {
    for (const [key, input] of sliders) {
      const v = paramAt(key);
      if (document.activeElement !== input) input.value = String(v);
    }
    for (const [key, el] of readouts) el.textContent = paramAt(key).toFixed(2);
  };

  const setPreset = (count: number): void => {
    presetCount = count;
    buildRoster();
    refreshHud();
    save();
  };

  const buildHud = (): void => {
    const presetRow = document.createElement('div');
    presetRow.className = 'lab-variants';
    ([[1, 14], [2, 40], [3, 120]] as [number, number][]).forEach(([label, count]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = String(label);
      btn.title = count + ' artists';
      btn.addEventListener('click', () => setPreset(count));
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

  window.addEventListener('resize', resize);

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
    const basis = camBasis();
    const fp = normalize3({ x: basis.fwd.x, y: 0, z: basis.fwd.z });
    const worldPerPx = (dist * 2 * Math.tan(FOV / 2)) / canvas.clientHeight;
    const dx = (e.clientX - lastX) * worldPerPx;
    const dy = (e.clientY - lastY) * worldPerPx;
    lastX = e.clientX;
    lastY = e.clientY;
    targetX -= basis.right.x * dx + fp.x * dy;
    targetZ -= basis.right.z * dx + fp.z * dy;
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const basis = camBasis();
    const cp = camPos();
    const dir = rayDir((e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr, basis);
    const factor = Math.exp(-e.deltaY * 0.0011);
    const next = Math.min(DIST_MAX, Math.max(DIST_MIN, dist * factor));
    if (next === dist) return;
    if (dir.y < 0) {
      const t = cp.y / -dir.y;
      const fx = cp.x + dir.x * t;
      const fz = cp.z + dir.z * t;
      const k = next / dist;
      targetX = fx + (targetX - fx) * k;
      targetZ = fz + (targetZ - fz) * k;
    }
    dist = next;
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === '1') setPreset(14);
    else if (e.key === '2') setPreset(40);
    else if (e.key === '3') setPreset(120);
    else if (e.key === 'h' || e.key === 'H') hud.classList.toggle('hidden');
  });

  buildHud();
  resize();
  buildRoster();

  const labRecord: Record<string, unknown> = {
    ok: true,
    population: stars.length,
    glErrors,
    preset: presetCount,
    dist,
    resetView: () => {
      targetX = 0;
      targetZ = 0;
      dist = 150;
      labRecord['dist'] = dist;
    },
    setZoom: (d: number) => {
      dist = Math.min(DIST_MAX, Math.max(DIST_MIN, d));
      labRecord['dist'] = dist;
    },
    setParam: (key: string, value: number) => {
      setParam(key, value);
      refreshHud();
    },
    setPreset,
    focusLargest: () => {
      let best: Star | null = null;
      for (const s of stars) if (!best || s.mass > best.mass) best = s;
      if (best) {
        targetX = best.x;
        targetZ = best.z;
      }
    },
    positions: () => {
      const cp = camPos();
      const basis = camBasis();
      return stars.map((s) => {
        const c = project({ x: s.x, y: s.y, z: s.z }, cp, basis);
        return { x: Math.round(c.x / dpr), y: Math.round(c.y / dpr), r: Math.round((s.mass * c.scale) / dpr), mass: s.mass, name: s.name, behind: c.behind };
      });
    },
    metrics: () => {
      const cp = camPos();
      const basis = camBasis();
      let best: Star | null = null;
      for (const s of stars) if (!best || s.mass > best.mass) best = s;
      const c = best ? project({ x: best.x, y: best.y, z: best.z }, cp, basis) : { x: 0, y: 0, scale: 0, depth: 0, behind: true };
      return {
        x: Math.round(c.x / dpr),
        y: Math.round(c.y / dpr),
        r: Math.round(((best ? best.mass : 1) * c.scale) / dpr),
        dist,
        targetX,
        targetZ,
      };
    },
    dump: () => JSON.stringify(look),
  };
  (window as unknown as Record<string, unknown>).__lab = labRecord;

  const frame = (tms: number): void => {
    draw(tms * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
