export const STAR_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const STAR_FRAG = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uCam;
uniform float uPxPerUnit;
uniform float uDpr;
uniform float uExposure;
uniform vec3 uColorCore;
uniform vec3 uColorBody;
uniform vec3 uColorBloom;
uniform vec3 uColorHeart;
uniform vec3 uColorRim;
uniform vec3 uSparkA;
uniform vec3 uSparkB;
uniform float uCoreRadius;
uniform float uBodyRadius;
uniform float uBodyMode;
uniform float uRim;
uniform float uHeartMix;
uniform vec3 uBloomRadius;
uniform vec3 uBloomGain;
uniform float uSpikeLength;
uniform float uSpikeWidth;
uniform float uSpikeGain;
uniform float uSpikeAngle;
uniform float uDisperse;
uniform float uFacetGain;
uniform int uProngCount;
uniform vec4 uProngs[12];
uniform int uSparkleCount;
uniform vec4 uSparkles[28];
uniform vec4 uSparkMeta[28];
uniform float uSparkleGain;
uniform float uSparkleSize;
uniform float uShimmer;
uniform float uFlicker;
uniform float uFieldDensity;
uniform float uFieldGain;

out vec4 fragColor;

const vec3 VOID = vec3(0.0314, 0.0353, 0.0431);
const float PI2 = 1.5707963;

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

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
  vec2 starScreen = vec2(0.5) * uResolution - uCam * uPxPerUnit;
  vec2 v = fragCoord - starScreen;
  float dPx = length(v);
  float bodyPx = max(2.0, uBodyRadius * uPxPerUnit);
  float corePx = max(1.0, uCoreRadius * uPxPerUnit);

  float ang = atan(v.y, v.x);
  float facet = 1.0 + uFacetGain * (0.55 * sin(3.0 * ang + 1.7) + 0.35 * sin(5.0 * ang - 0.6) + 0.22 * sin(8.0 * ang + 3.9));

  vec3 lin = vec3(0.0);

  float b1Px = max(bodyPx * uBloomRadius.x, 7.0 * uDpr);
  float b2Px = max(bodyPx * uBloomRadius.y, 26.0 * uDpr);
  float b3Px = max(bodyPx * uBloomRadius.z, 60.0 * uDpr);
  float q1 = dPx / b1Px;
  float b1 = uBloomGain.x / pow(1.0 + q1 * q1, 2.2);
  float q2 = dPx / b2Px;
  float b2 = uBloomGain.y / pow(1.0 + q2 * q2, 1.8);
  float q3 = dPx / b3Px;
  float b3 = uBloomGain.z / pow(1.0 + q3 * q3, 1.8);
  vec3 bloomCol = mix(uColorBloom, uColorHeart, uHeartMix * 0.35 * exp(-dPx / b1Px));
  lin += bloomCol * (b1 * facet + b2 * mix(1.0, facet, 0.55) + b3);

  float x = clamp(dPx / bodyPx, 0.0, 1.0);
  float xu = dPx / bodyPx;
  float m1 = clamp(uBodyMode, 0.0, 1.0);
  float m2 = clamp(uBodyMode - 1.0, 0.0, 1.0);
  float wD = 1.0 - m1;
  float wO = m1 * (1.0 - m2);
  float wS = m2;

  vec3 bodyCol = mix(uColorBody, uColorHeart, uHeartMix * pow(1.0 - x, 1.5));
  float dBody = 1.35 * exp(-xu * xu * 5.0);
  float oIn = 1.0 - smoothstep(bodyPx - 5.0, bodyPx + 5.0, dPx);
  float oBody = oIn * mix(0.95, 0.28, pow(x, 1.4));
  float sIn = 1.0 - smoothstep(bodyPx - 5.0, bodyPx + 4.0, dPx);
  float sBody = sIn * mix(0.16, 0.08, x);
  float bodyLight = dBody * wD + oBody * wO + sBody * wS;
  lin += bodyCol * bodyLight * mix(1.0, facet, 0.25);

  float rimSigma = bodyPx * (0.028 + wS * 0.05);
  float rimN = (dPx - bodyPx) / max(1.0, rimSigma);
  float rimGain = uRim * (wO * 0.85 + wS * 1.7);
  lin += uColorRim * exp(-rimN * rimN) * rimGain * mix(1.0, facet, 0.5);

  float coreN = dPx / corePx;
  lin += uColorCore * exp(-pow(coreN, 1.6) * 1.8) * 2.4;

  float lenPx = max(bodyPx * uSpikeLength, 24.0 * uDpr);
  float widPx = max(5.0 * uDpr, bodyPx * 0.1 * uSpikeWidth);
  float prongLight = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= uProngCount) break;
    vec4 pr = uProngs[i];
    vec2 pv = rot(uSpikeAngle + pr.x) * v;
    float nx = pv.x / (lenPx * pr.y);
    float ny = pv.y / max(1.0, widPx * pr.z);
    prongLight += exp(-nx * nx * 2.0) * exp(-ny * ny) * pr.w;
  }
  prongLight *= uSpikeGain;
  float prisma = clamp(dPx / (lenPx * 1.1), 0.0, 1.0) * uDisperse;
  lin += mix(uColorCore, uColorBloom, prisma) * prongLight;

  for (int i = 0; i < 28; i++) {
    if (i >= uSparkleCount) break;
    vec4 sp = uSparkles[i];
    vec4 meta = uSparkMeta[i];
    vec2 sv = v - sp.xy;
    float r = max(1.5, sp.z);
    float sd2 = dot(sv, sv);
    float mang = atan(sv.y, sv.x);
    float m = 4.0 + floor(meta.x * 2.99);
    float starMod = 0.5 + 0.5 * pow(abs(cos(m * mang + meta.z * 6.2831)), 3.0);
    float shape = exp(-sd2 / (r * r)) * (0.45 + 0.55 * starMod);
    float tw = 1.0 - uShimmer * (0.5 + 0.5 * sin(uTime * 2.3 + sp.w * 6.2831));
    tw *= 1.0 - uFlicker * 0.6 * (0.5 + 0.5 * sin(uTime * (3.1 + fract(sp.w * 7.31) * 5.0) + sp.w * 40.0));
    vec3 scol = mix(uColorCore, mix(uSparkA, uSparkB, meta.y), 0.5 + meta.y * 0.35);
    lin += scol * shape * uSparkleGain * tw;
  }

  vec2 fieldPx = fragCoord + uCam * uPxPerUnit * 0.35;
  vec3 field = fieldStars(fieldPx, 176.0 * uDpr, uFieldDensity, uFieldGain)
             + fieldStars(fieldPx, 84.0 * uDpr, uFieldDensity * 0.75, uFieldGain * 0.6);
  lin += field;

  vec3 c = max(lin * uExposure - 0.009, vec3(0.0));
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  float dither = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
  fragColor = vec4(VOID + c + (dither - 0.5) * (1.8 / 255.0), 1.0);
}
`;
