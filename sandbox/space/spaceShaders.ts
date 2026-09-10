export const SPACE_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SPACE_FRAG = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform vec2 uCanvas;
uniform vec2 uViewOrigin;
uniform float uTime;
uniform float uDpr;
uniform float uExposure;
uniform float uStarGain;
uniform float uVoidGain;
uniform float uFieldDensity;
uniform float uFieldGain;
uniform vec2 uDustOffset;

uniform vec2 uCenter;
uniform float uRadius;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamForward;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec3 uSphereCenter;
uniform float uSphereRadius;
uniform vec3 uColorCore;
uniform vec3 uColorBody;
uniform vec3 uColorHeart;
uniform vec3 uColorBloom;
uniform vec3 uColorRim;
uniform float uSpikeIntensity;
uniform float uSpikeLength;
uniform float uGlowGain;
uniform int uMoteCount;
uniform vec4 uMotes[14];
uniform vec4 uMoteMeta[14];
uniform float uMoteGain;
uniform float uShimmer;

out vec4 fragColor;

const vec3 VOID = vec3(0.0314, 0.0353, 0.0431);

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 fieldStars(vec2 px, float cellPx, float prob, float gain) {
  vec2 id = floor(px / cellPx);
  float sel = hash21(id * 1.37 + 41.7);
  if (sel > prob) return vec3(0.0);
  vec2 pos = vec2(hash21(id + 3.1), hash21(id + 17.9)) * cellPx;
  float d = length(px - (id * cellPx + pos));
  float mag = pow(hash21(id + 53.3), 7.0);
  float temp = hash21(id + 71.9);
  vec3 col = mix(vec3(1.0, 0.78, 0.56), vec3(0.72, 0.82, 1.0), temp);
  col = mix(col, vec3(1.0, 0.5, 0.42), step(0.94, temp) * 0.6);
  float core = exp(-d * d / 1.4);
  float halo = exp(-d * d / 7.0) * 0.32;
  return col * (core + halo) * (0.15 + mag) * gain;
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec3 col = vec3(0.0);

  if (uStarGain > 0.5) {
    vec2 ndc = (fragCoord / uCanvas) * 2.0 - 1.0;
    vec3 dir = normalize(uCamForward + uCamRight * (ndc.x * uTanHalfFov * uAspect) + uCamUp * (ndc.y * uTanHalfFov));
    vec3 oc = uCamPos - uSphereCenter;
    float b = dot(oc, dir);
    float cc = dot(oc, oc) - uSphereRadius * uSphereRadius;
    float disc = b * b - cc;
    float dPx = length(fragCoord - uCenter);
    vec3 coreCol = uColorCore;
    vec3 bloomCol = mix(uColorBloom, uColorHeart, 0.25);

    if (disc > 0.0) {
      float t = -b - sqrt(disc);
      if (t > 0.0) {
        vec3 n = normalize(oc + dir * t);
        float ndv = clamp(dot(n, -dir), 0.0, 1.0);
        float limb = pow(ndv, 0.5);
        float hot = exp(-pow(1.0 - ndv, 2.0) * 3.5);
        vec3 bodyCol = mix(uColorBody, uColorHeart, hot * 0.5);
        float light = 0.18 + 0.72 * limb + 0.5 * hot;
        col += bodyCol * light;
        float corePx = max(1.0, uRadius * 0.32);
        col += coreCol * exp(-pow(dPx / corePx, 2.0)) * 0.9;
      }
    }

    float ring = exp(-pow((dPx - uRadius * 0.92) / max(1.0, uRadius * 0.2), 2.0));
    col += uColorRim * ring * 0.45;

    float haloQ = dPx / max(1.0, uRadius * 2.0);
    col += bloomCol * (uGlowGain / pow(1.0 + haloQ * haloQ, 3.5));

    vec2 rel = fragCoord - uCenter;
    float lenPx = max(uRadius * uSpikeLength, 30.0 * uDpr);
    float widPx = max(1.3 * uDpr, uRadius * 0.055);
    float sx = exp(-abs(rel.x) / lenPx * 2.2) * exp(-(rel.y * rel.y) / (widPx * widPx));
    float sy = exp(-abs(rel.y) / lenPx * 2.2) * exp(-(rel.x * rel.x) / (widPx * widPx));
    vec3 spikeCol = mix(coreCol, uColorBloom, clamp(dPx / lenPx, 0.0, 1.0));
    col += spikeCol * ((sx + sy) * uSpikeIntensity);

    for (int i = 0; i < 14; i++) {
      if (i >= uMoteCount) break;
      vec4 m = uMotes[i];
      vec2 mr = fragCoord - m.xy;
      float r = max(1.2, m.z);
      float sd2 = dot(mr, mr);
      float lobes = 0.5 + 0.5 * pow(abs(cos(4.0 * atan(mr.y, mr.x) + m.w * 6.2831)), 3.0);
      float starMod = mix(0.5, lobes, step(0.5, uMoteMeta[i].x));
      float shape = exp(-sd2 / (r * r)) * (0.45 + 0.55 * starMod);
      float tw = 1.0 - uShimmer * (0.5 + 0.5 * sin(uTime * 2.1 + m.w * 6.2831));
      vec3 mcol = mix(mix(uColorBody, uColorBloom, uMoteMeta[i].y), coreCol, 0.35);
      col += mcol * shape * uMoteGain * tw;
    }
  }

  vec2 fieldPx = fragCoord + uDustOffset;
  vec3 field = fieldStars(fieldPx, 176.0 * uDpr, uFieldDensity, uFieldGain)
             + fieldStars(fieldPx, 84.0 * uDpr, uFieldDensity * 0.75, uFieldGain * 0.6);
  vec3 lin = col * uStarGain + field;

  vec3 c = max(lin * uExposure - 0.009, vec3(0.0));
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  float localX = fragCoord.x - uViewOrigin.x;
  float localY = fragCoord.y - uViewOrigin.y;
  float borderX = min(localX, uResolution.x - localX);
  float borderY = min(localY, uResolution.y - localY);
  float border = mix(1.0, smoothstep(0.0, 12.0, min(borderX, borderY)), step(uVoidGain, 0.5));
  float dither = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
  fragColor = vec4(VOID * uVoidGain + c * border + (dither - 0.5) * (1.8 / 255.0) * uVoidGain, 1.0);
}
`;
