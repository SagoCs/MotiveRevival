import { STAR_VERT, STAR_FRAG } from './starShader';
import {
  starRecipe,
  seedToFloat,
  LIGHT_EXTENT,
  MOTE_MAX,
  type StarSeedInput,
  type StarUniforms,
} from './starParams';
import { fx } from '../core/fx';

const PX_PER_UNIT = 20;
const FOV = (50 * Math.PI) / 180;
const TAN_HALF_FOV = Math.tan(FOV / 2);
const CAM_POS: [number, number, number] = [0, 0, 0];
const CAM_FWD: [number, number, number] = [0, 0, -1];
const CAM_RIGHT: [number, number, number] = [1, 0, 0];
const CAM_UP: [number, number, number] = [0, 1, 0];
const FALLBACK_VOID: [number, number, number] = [0x08 / 255, 0x09 / 255, 0x0b / 255];

interface StarState {
  input: StarSeedInput;
  recipe: StarUniforms;
  seed: number;
}

let canvas: HTMLCanvasElement | null = null;
let gl: WebGL2RenderingContext | null = null;
let uniforms = new Map<string, WebGLUniformLocation | null>();
let star: StarState | null = null;
let raf = 0;
let time = 0;
let lastNow = 0;
let viewW = 0;
let viewH = 0;
let dpr = 1;
let clearRgb: [number, number, number] = FALLBACK_VOID;
const cam = { x: 0, y: 0, z: 1 };
const motePack = new Float32Array(MOTE_MAX * 4);

function compile(type: number, src: string): WebGLShader {
  const ctx = gl as WebGL2RenderingContext;
  const s = ctx.createShader(type);
  if (s === null) throw new Error('shader create failed');
  ctx.shaderSource(s, src);
  ctx.compileShader(s);
  if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS)) {
    throw new Error(ctx.getShaderInfoLog(s) || 'shader compile failed');
  }
  return s;
}

function parseVoid(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--void-0').trim();
  const m = /^#([0-9a-f]{6})$/i.exec(raw);
  if (m === null || m[1] === undefined) return FALLBACK_VOID;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function mountStarfield(surface: HTMLElement): void {
  if (canvas !== null) return;
  canvas = document.createElement('canvas');
  surface.prepend(canvas);
  const ctx = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (ctx === null) return;
  gl = ctx;
  const program = gl.createProgram();
  if (program === null) throw new Error('program create failed');
  gl.attachShader(program, compile(gl.VERTEX_SHADER, STAR_VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, STAR_FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
  }
  gl.useProgram(program);
  uniforms = new Map();
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(program, i);
    if (info === null) continue;
    uniforms.set(info.name.replace(/\[0\]$/, ''), gl.getUniformLocation(program, info.name));
  }
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  clearRgb = parseVoid();
}

function u(name: string): WebGLUniformLocation | null {
  return uniforms.get(name) ?? null;
}

export function resizeStarfield(width: number, height: number): void {
  viewW = width;
  viewH = height;
  if (canvas === null || gl === null) return;
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
}

export function setStar(input: StarSeedInput | null): void {
  star = input === null ? null : { input, recipe: starRecipe(input), seed: input.seed };
}

export function updateStarCamera(camX: number, camY: number, zoom: number): void {
  cam.x = camX;
  cam.y = camY;
  cam.z = zoom;
  draw();
}

function placeAt(cx: number, cy: number, radiusPx: number, worldRadius: number): {
  sphereCenter: [number, number, number];
  dist: number;
} {
  const c = canvas as HTMLCanvasElement;
  const ndcX = (cx / c.width) * 2 - 1;
  const ndcY = (cy / c.height) * 2 - 1;
  const aspect = c.width / c.height;
  const dx = CAM_FWD[0] + CAM_RIGHT[0] * ndcX * TAN_HALF_FOV * aspect + CAM_UP[0] * ndcY * TAN_HALF_FOV;
  const dy = CAM_FWD[1] + CAM_RIGHT[1] * ndcX * TAN_HALF_FOV * aspect + CAM_UP[1] * ndcY * TAN_HALF_FOV;
  const dz = CAM_FWD[2] + CAM_RIGHT[2] * ndcX * TAN_HALF_FOV * aspect + CAM_UP[2] * ndcY * TAN_HALF_FOV;
  const len = Math.hypot(dx, dy, dz);
  const dist = (worldRadius * c.height) / (2 * radiusPx * TAN_HALF_FOV);
  return {
    sphereCenter: [CAM_POS[0] + (dx / len) * dist, CAM_POS[1] + (dy / len) * dist, CAM_POS[2] + (dz / len) * dist],
    dist,
  };
}

function draw(): void {
  const c = canvas;
  const ctx = gl;
  if (c === null || ctx === null) return;
  ctx.viewport(0, 0, c.width, c.height);
  ctx.clearColor(clearRgb[0], clearRgb[1], clearRgb[2], 1);
  ctx.clear(ctx.COLOR_BUFFER_BIT);
  ctx.uniform2f(u('uResolution'), c.width, c.height);
  ctx.uniform3f(u('uCamPos'), CAM_POS[0], CAM_POS[1], CAM_POS[2]);
  ctx.uniform3f(u('uCamRight'), CAM_RIGHT[0], CAM_RIGHT[1], CAM_RIGHT[2]);
  ctx.uniform3f(u('uCamUp'), CAM_UP[0], CAM_UP[1], CAM_UP[2]);
  ctx.uniform3f(u('uCamFwd'), CAM_FWD[0], CAM_FWD[1], CAM_FWD[2]);
  ctx.uniform1f(u('uTanHalfFov'), TAN_HALF_FOV);
  ctx.uniform1f(u('uAspect'), c.width / c.height);

  let radiusCss = 0;
  let cxCss = viewW / 2 + cam.x;
  let cyCss = viewH / 2 + cam.y;
  if (star !== null) {
    const radiusPx = star.recipe.worldRadius * PX_PER_UNIT * cam.z * dpr;
    radiusCss = radiusPx / dpr;
    if (radiusPx >= 0.6) {
      const cx = cxCss * dpr;
      const cy = c.height - cyCss * dpr;
      const placed = placeAt(cx, cy, radiusPx, star.recipe.worldRadius);
      ctx.viewport(
        Math.round(cx - LIGHT_EXTENT * radiusPx),
        Math.round(cy - LIGHT_EXTENT * radiusPx),
        Math.round(2 * LIGHT_EXTENT * radiusPx),
        Math.round(2 * LIGHT_EXTENT * radiusPx),
      );
      ctx.uniform2f(u('uCenterPx'), cx, cy);
      ctx.uniform1f(u('uRadiusPx'), radiusPx);
      ctx.uniform3f(u('uSphereCenter'), placed.sphereCenter[0], placed.sphereCenter[1], placed.sphereCenter[2]);
      ctx.uniform1f(u('uWorldRadius'), star.recipe.worldRadius);
      ctx.uniform1f(u('uDist'), placed.dist);
      ctx.uniform3f(u('uColCore'), star.recipe.colorCore[0], star.recipe.colorCore[1], star.recipe.colorCore[2]);
      ctx.uniform3f(u('uColBody'), star.recipe.colorBody[0], star.recipe.colorBody[1], star.recipe.colorBody[2]);
      ctx.uniform3f(u('uColBloom'), star.recipe.colorBloom[0], star.recipe.colorBloom[1], star.recipe.colorBloom[2]);
      ctx.uniform1f(u('uGlowGain'), star.recipe.glowGain);
      ctx.uniform1f(u('uCoreHeat'), star.recipe.coreHeat);
      ctx.uniform1f(u('uMoteGain'), star.recipe.moteGain);
      ctx.uniform1f(u('uMoteCount'), star.recipe.moteCount);
      const md = motePack;
      star.recipe.motes.forEach((m, i) => {
        md[i * 4 + 0] = m.sizeNorm;
        md[i * 4 + 1] = m.speedMul;
        md[i * 4 + 2] = m.phase;
        md[i * 4 + 3] = 0;
      });
      ctx.uniform4fv(u('uMoteData'), md);
      ctx.uniform1f(u('uSeed'), seedToFloat(star.seed));
      ctx.uniform1f(u('uTime'), time);
      ctx.uniform1f(u('uKick'), 0);
      ctx.drawArrays(ctx.TRIANGLES, 0, 3);
    }
  }
  (window as unknown as { __universeStar: unknown }).__universeStar = {
    hue: star !== null ? star.input.hue : null,
    sat: star !== null ? star.input.sat : null,
    mass: star !== null ? star.recipe.worldRadius : null,
    seed: star !== null ? star.seed : null,
    cx: cxCss,
    cy: cyCss,
    radiusCss,
    time,
    drawn: star !== null && star.recipe.worldRadius * PX_PER_UNIT * cam.z * dpr >= 0.6,
  };
}

function loop(now: number): void {
  raf = 0;
  if (!fx.motion) {
    draw();
    return;
  }
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  time += dt;
  draw();
  raf = window.requestAnimationFrame(loop);
}

export function wakeStarfield(): void {
  if (raf !== 0 || !fx.motion) return;
  lastNow = performance.now();
  raf = window.requestAnimationFrame(loop);
}

export function parkStarfield(): void {
  if (raf !== 0) {
    window.cancelAnimationFrame(raf);
    raf = 0;
  }
}

export function refreshStarfieldMotion(): void {
  if (!fx.motion) {
    parkStarfield();
    draw();
    return;
  }
  wakeStarfield();
}
