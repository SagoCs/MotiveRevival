export const STAR_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const STAR_FRAG = `#version 300 es
precision highp float;

uniform vec2  uResolution;
uniform vec2  uCenterPx;
uniform float uRadiusPx;
uniform vec3  uSphereCenter;
uniform float uWorldRadius;
uniform float uDist;
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform float uTanHalfFov;
uniform float uAspect;

uniform float uTime;
uniform float uSeed;
uniform float uKick;

uniform vec3  uColCore;
uniform vec3  uColBody;
uniform vec3  uColBloom;
uniform float uGlowGain;
uniform float uCoreHeat;
uniform float uMoteGain;
uniform float uMoteCount;
uniform vec4  uMoteData[12];

out vec4 fragColor;

const float TAU = 6.283185307179586;

float hash11(float n) { return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453123); }
vec3  hash31(float n) { return vec3(hash11(n), hash11(n + 17.17), hash11(n + 43.43)); }
float pxHash(vec2 p)  { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }

vec3 corona(float r) {
  float R = max(uRadiusPx, 0.75);
  float g = uGlowGain;
  vec3 ct = mix(uColBloom, uColBody, 0.25);
  float q = r / max(R * 1.6, 1.0);
  float fade = exp(-pow(r / (R * 4.6), 2.2));
  return ct * (g * 0.9 * fade / pow(1.0 + q * q, 4.0));
}

void main() {
  vec2 fragPx = gl_FragCoord.xy;
  vec2 rel = fragPx - uCenterPx;
  float r = length(rel);
  float R = max(uRadiusPx, 0.75);

  vec3 col = uColCore * exp(-pow(r / (R * 0.42 + 0.6), 2.0)) * 2.0;

  float zoomFade = smoothstep(10.0, 24.0, uRadiusPx);
  float rw = (R * 0.30 + 0.4) * mix(0.6, 1.0, zoomFade);
  vec3 hotTint = mix(uColCore, vec3(1.0), 0.55);
  col += hotTint * (exp(-pow(r / rw, 2.0)) * uCoreHeat * 1.2 * zoomFade);

  col += uColBody * exp(-pow(r / (R * 0.95 + 0.4), 2.6)) * 0.8;

  col += corona(r);

  if (uRadiusPx >= 6.0) {
    for (int i = 0; i < 12; i++) {
      if (float(i) >= uMoteCount) break;
      float fi = float(i);
      vec4 md = uMoteData[i];
      vec3 ax = normalize(hash31(fi * 13.7 + 1.0) * 2.0 - 1.0);
      vec3 u1 = normalize(cross(ax, vec3(0.0, 1.0, 0.001)));
      vec3 u2 = cross(ax, u1);
      float orbitR = uWorldRadius * (1.9 + 1.5 * hash11(fi * 21.3));
      float spd = (0.35 + 0.8 * hash11(fi * 33.1)) * md.y
                * (hash11(fi * 5.9) > 0.5 ? 1.0 : -1.0);
      float a = md.z + uTime * spd;
      vec3 wp = uSphereCenter + (u1 * cos(a) + u2 * sin(a)) * orbitR;

      vec3 v = wp - uCamPos;
      float z = dot(v, uCamFwd);
      if (z <= 0.1) continue;
      vec2 off = vec2(dot(v, uCamRight) / (z * uTanHalfFov * uAspect),
                      dot(v, uCamUp)    / (z * uTanHalfFov)) * uResolution * 0.5
               - (uCenterPx - uResolution * 0.5);
      vec2 mr = fragPx - (uCenterPx + off);
      float heartR = R * 0.42 + 0.6;
      float heartFade = smoothstep(heartR * 0.75, heartR * 1.15, length(fragPx - uCenterPx));
      float sz = min(3.2, max(1.3, uRadiusPx * (0.028 + 0.05 * md.x) * (0.8 + 0.4 * hash11(fi * 9.9))));
      float sd2 = dot(mr, mr) / (sz * sz);
      float shape = exp(-sd2) * (0.85 + 0.15 * abs(cos(atan(mr.y, mr.x) + md.z)));
      float tw = 1.0 - 0.4 * (0.5 + 0.5 * sin(uTime * (1.2 + 1.6 * hash11(fi * 3.7)) + md.z * 3.0));
      vec3 mc = mix(uColBody, uColBloom, hash11(fi * 27.1)) * 1.6;
      col += mc * shape * uMoteGain * tw * 1.7 * heartFade;
    }
  }

  col *= 1.0 + uKick * 0.4;

  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float mapped = 1.0 - exp(-lum);
  vec3 outc = col * (mapped / max(lum, 1e-6));
  float mx = max(outc.x, max(outc.y, outc.z));
  if (mx > 1.0) outc /= mx;
  outc = pow(max(outc, vec3(0.0)), vec3(1.0 / 2.2));
  outc += (pxHash(fragPx) - 0.5) * (1.5 / 255.0);
  fragColor = vec4(max(outc, vec3(0.0)), 1.0);
}
`;
