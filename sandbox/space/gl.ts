export type Renderer = {
  gl: WebGL2RenderingContext;
  setF(name: string, v: number): void;
  setI(name: string, v: number): void;
  setV2(name: string, x: number, y: number): void;
  setV3(name: string, x: number, y: number, z: number): void;
  setV4Array(name: string, data: Float32Array): void;
  setViewport(x: number, y: number, w: number, h: number): void;
  setBlend(on: boolean): void;
  drawFullscreen(): void;
};

export type GlResult = { ok: true; renderer: Renderer } | { ok: false; error: string };

export function createRenderer(canvas: HTMLCanvasElement, vertSrc: string, fragSrc: string): GlResult {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
  if (!gl) return { ok: false, error: 'webgl2 unavailable' };

  const compile = (type: number, src: string): { ok: true; shader: WebGLShader } | { ok: false; error: string } => {
    const shader = gl.createShader(type);
    if (!shader) return { ok: false, error: 'shader creation failed' };
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
      gl.deleteShader(shader);
      return { ok: false, error: log };
    }
    return { ok: true, shader };
  };

  const v = compile(gl.VERTEX_SHADER, vertSrc);
  if (!v.ok) return v;
  const f = compile(gl.FRAGMENT_SHADER, fragSrc);
  if (!f.ok) return f;
  const program = gl.createProgram();
  if (!program) return { ok: false, error: 'program creation failed' };
  gl.attachShader(program, v.shader);
  gl.attachShader(program, f.shader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return { ok: false, error: gl.getProgramInfoLog(program) ?? 'unknown link error' };
  }
  gl.useProgram(program);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  const locs = new Map<string, WebGLUniformLocation>();
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const loc = gl.getUniformLocation(program, info.name);
    if (loc) locs.set(info.name.replace('[0]', ''), loc);
  }

  const impl: Renderer = {
    gl,
    setF: (name, val) => { const l = locs.get(name); if (l) gl.uniform1f(l, val); },
    setI: (name, val) => { const l = locs.get(name); if (l) gl.uniform1i(l, val); },
    setV2: (name, x, y) => { const l = locs.get(name); if (l) gl.uniform2f(l, x, y); },
    setV3: (name, x, y, z) => { const l = locs.get(name); if (l) gl.uniform3f(l, x, y, z); },
    setV4Array: (name, data) => { const l = locs.get(name); if (l) gl.uniform4fv(l, data); },
    setViewport: (x, y, w, h) => gl.viewport(x, y, w, h),
    setBlend: (on) => {
      if (on) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
      } else {
        gl.disable(gl.BLEND);
      }
    },
    drawFullscreen(): void {
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };

  return { ok: true, renderer: impl };
}
