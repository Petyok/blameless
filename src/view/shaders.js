// GLSL for every material. Written for three's ShaderMaterial (GLSL1-style keywords, compiled as ES 3.0).
// Everything is unlit display-referred colour: dark fills, bright edges, fog to the act colour.

const COMMON = /* glsl */`
uniform vec3 uFog; uniform float uFogD; uniform float uTime; uniform vec3 uAccent; uniform float uBass;
uniform vec4 uLightPos[4]; uniform vec3 uLightCol[4];
float hash1(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec3 lights(vec3 wp) {
  vec3 s = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 d = uLightPos[i].xyz - wp;
    float a = max(0.0, 1.0 - dot(d, d) / (uLightPos[i].w * uLightPos[i].w));
    s += uLightCol[i] * a * a;
  }
  return s;
}
float fogAt(vec3 wp) { return 1.0 - exp(-distance(wp, cameraPosition) * uFogD); }
`;

export const FLOOR = {
  vertexShader: COMMON + /* glsl */`
attribute vec3 iTile; // x, z, random
uniform vec4 uRip[8]; // x, z, start time, strength
uniform float uTile;
varying vec2 vUv; varying vec3 vWp; varying float vH; varying float vRand; varying float vSide; varying vec3 vLight;
void main() {
  float h = 0.0;
  for (int i = 0; i < 8; i++) {
    float age = uTime - uRip[i].z, d = distance(iTile.xy, uRip[i].xy), x = (d - age * 17.0) * 0.5;
    h += exp(-x * x) * uRip[i].w * exp(-age * 1.5) * step(0.0, age);
  }
  float beat = uBass * (0.03 + 0.16 * step(0.88, iTile.z));
  h = min(h, 1.4); // a ripple is a ripple: tiles must not read as steps or hide enemies
  vH = h;
  vec3 p = position;
  p.xz *= uTile * 0.955;
  p.y += h * 0.24 + beat;
  vWp = vec3(iTile.x + p.x, p.y, iTile.y + p.z);
  vUv = uv; vRand = iTile.z; vSide = 1.0 - abs(normal.y);
  vLight = lights(vec3(iTile.x, 0.3, iTile.y));
  gl_Position = projectionMatrix * viewMatrix * vec4(vWp, 1.0);
}`,
  fragmentShader: COMMON + /* glsl */`
varying vec2 vUv; varying vec3 vWp; varying float vH; varying float vRand; varying float vSide; varying vec3 vLight;
void main() {
  float d = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float fw = max(fwidth(vUv.x), fwidth(vUv.y));
  float line = (1.0 - smoothstep(0.035 - fw, 0.035 + fw, d)) * clamp(0.06 / fw, 0.0, 1.0);
  float glow = 0.22 + vH * 2.2 + uBass * 0.3 + 0.5 * step(0.88, vRand) * uBass;
  vec3 col = vec3(0.016, 0.02, 0.024) * (0.6 + 0.8 * vRand) + uAccent * 0.012;
  col += uAccent * line * glow + uAccent * vH * 0.35;
  col = mix(col, uAccent * (0.05 + vH * 0.6), vSide);
  col += vLight * (0.3 + 0.7 * line);
  gl_FragColor = vec4(mix(col, uFog, fogAt(vWp)), 1.0);
}`,
};

export const BLOCKS = {
  vertexShader: COMMON + /* glsl */`
attribute vec3 iPos; attribute vec3 iSize; attribute vec2 iKind; // kind (0 rack, 1 wall), seed
varying vec3 vWp; varying vec3 vN; varying vec2 vKind; varying vec3 vLight; varying vec2 vUv;
void main() {
  vWp = iPos + position * iSize;
  vN = normal; vKind = iKind; vUv = uv;
  vLight = lights(vWp);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWp, 1.0);
}`,
  fragmentShader: COMMON + /* glsl */`
uniform sampler2D tLogs; uniform float uAlarm;
varying vec3 vWp; varying vec3 vN; varying vec2 vKind; varying vec3 vLight; varying vec2 vUv;
void main() {
  // u runs left to right for whoever faces the surface, so wall text is never mirrored
  float u = vN.z * vWp.x - vN.x * vWp.z, fog = fogAt(vWp);
  vec3 col;
  if (vKind.x > 0.5) {
    // wall: a slow tail -f, brighter near the floor
    float txt = texture2D(tLogs, vec2(u / 26.0 + vKind.y, vWp.y / 26.0 - uTime * 0.011)).r;
    float low = exp(-vWp.y * 0.16);
    col = vec3(0.007, 0.009, 0.011) + mix(uAccent, vec3(1.0, 0.12, 0.1), uAlarm) * txt * (0.1 + 0.34 * low + 0.12 * uBass);
    col += uAccent * 0.05 * exp(-vWp.y * 1.6);
  } else if (vN.y > 0.5) {
    // rack top: the hot aisle
    float g = step(0.5, fract(vWp.x * 5.0)) * step(0.12, fract(vWp.z * 1.0));
    col = vec3(0.02, 0.008, 0.006) + vec3(1.0, 0.22, 0.04) * g * (0.28 + 0.12 * sin(uTime * 2.7 + vWp.x + vWp.z));
  } else {
    // rack side: unit lines and status LEDs
    vec2 q = vec2(u * 6.0, vWp.y * 5.0), cell = floor(q), f = fract(q);
    float hsh = hash1(cell + vKind.y * 91.0), far = clamp(fwidth(q.x) * 1.5, 0.0, 1.0);
    float led = step(0.3, f.x) * step(f.x, 0.7) * step(0.32, f.y) * step(f.y, 0.62);
    float on = step(0.62, hsh) * mix(0.12, 1.0, step(0.0, sin(uTime * (1.5 + hsh * 11.0) + hsh * 50.0)));
    vec3 lc = mix(uAccent, vec3(1.0, 0.16, 0.08), step(0.965, hsh));
    col = vec3(0.016, 0.019, 0.024) * (1.0 - 0.55 * step(0.9, f.y)) + lc * mix(led * on * 1.25, 0.11, far);
    float e = min(vUv.x, 1.0 - vUv.x) / max(fwidth(vUv.x), 1e-5);
    col += uAccent * 0.5 * (1.0 - smoothstep(0.8, 2.0, e));
  }
  col += vLight * 0.35;
  gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
}`,
};

// Unit boxes with a matrix per instance: every dynamic thing. ADD variant: additive, fades with fog.
export const BOXES = {
  vertexShader: COMMON + /* glsl */`
attribute mat4 iM; attribute vec4 iCol; attribute vec4 iFx; // rgb+glow; flash, unused, flicker seed, unused
varying vec2 vUv; varying vec3 vWp; varying vec3 vN; varying vec4 vCol; varying vec4 vFx;
void main() {
  vec4 wp = iM * vec4(position, 1.0);
  vWp = wp.xyz; vUv = uv; vCol = iCol; vFx = iFx;
  vN = normalize(mat3(iM) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
  fragmentShader: COMMON + /* glsl */`
varying vec2 vUv; varying vec3 vWp; varying vec3 vN; varying vec4 vCol; varying vec4 vFx;
void main() {
  vec2 fw = max(fwidth(vUv), vec2(1e-5)), e2 = min(vUv, 1.0 - vUv) / fw;
  float edge = 1.0 - smoothstep(0.7, 1.9, min(e2.x, e2.y));
#ifdef ADD
  vec3 col = vCol.rgb * (vCol.a + edge * 0.4) * (1.0 - fogAt(vWp));
  gl_FragColor = vec4(col, 1.0);
#else
  if (vFx.z > 0.0 && hash1(floor(gl_FragCoord.xy * 0.5) + floor(uTime * 24.0) + vFx.z * 17.0) < 0.42) discard;
  float lit = 0.4 + 0.6 * max(0.0, dot(vN, vec3(0.28, 0.92, 0.26)));
  vec3 col = vCol.rgb * (0.2 * lit + vCol.a) + vCol.rgb * edge * 1.1 + lights(vWp) * 0.45 * lit;
  col = mix(col, vec3(1.0), vFx.x);
  gl_FragColor = vec4(mix(col, uFog, fogAt(vWp)), 1.0);
#endif
}`,
};

export const GLYPHS = {
  vertexShader: COMMON + /* glsl */`
attribute vec4 iPos; attribute vec4 iCol; attribute vec2 iGlyph; // xyz+size; rgb+alpha; index, rotation
varying vec2 vUv; varying vec3 vCol;
void main() {
  vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
  float c = cos(iGlyph.y), s = sin(iGlyph.y);
  vec2 q = position.xy * vec2(0.6, 1.0) * iPos.w;
  mv.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  gl_Position = projectionMatrix * mv;
  vUv = vec2((mod(iGlyph.x, 16.0) + uv.x) / 16.0, 1.0 - (floor(iGlyph.x / 16.0) + 1.0 - uv.y) / 6.0);
  vCol = iCol.rgb * iCol.a * exp(mv.z * uFogD * 0.6);
}`,
  fragmentShader: /* glsl */`
uniform sampler2D tGlyph;
varying vec2 vUv; varying vec3 vCol;
void main() { gl_FragColor = vec4(vCol * texture2D(tGlyph, vUv).r, 1.0); }`,
};

// A cheap far backdrop: a grid of cable trays overhead that fades into the dark.
export const SKY = {
  vertexShader: /* glsl */`
varying vec3 vWp;
void main() { vWp = position + vec3(cameraPosition.x, 0.0, cameraPosition.z); gl_Position = projectionMatrix * viewMatrix * vec4(vWp, 1.0); }`,
  fragmentShader: COMMON + /* glsl */`
varying vec3 vWp;
void main() {
  vec2 q = vWp.xz / 6.0, f = abs(fract(q) - 0.5), fw = fwidth(q);
  float gx = 1.0 - smoothstep(0.0, fw.x * 1.5 + 0.004, 0.5 - f.x), gz = 1.0 - smoothstep(0.0, fw.y * 1.5 + 0.004, 0.5 - f.y);
  float g = max(gx, gz) * clamp(0.08 / max(fw.x, fw.y), 0.0, 1.0);
  float blink = step(0.985, hash1(floor(q) + floor(uTime * 1.5))) * (1.0 - max(f.x, f.y) * 2.0);
  float fade = exp(-distance(vWp.xz, cameraPosition.xz) * 0.03);
  gl_FragColor = vec4(uFog * 0.6 + uAccent * (g * 0.16 + blink * 0.5 + uBass * g * 0.1) * fade, 1.0);
}`,
};

const QUAD = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Bright pass, 2x downsample.
export const BRIGHT = {
  vertexShader: QUAD,
  fragmentShader: /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = (texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb
    + texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb) * 0.25;
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * smoothstep(0.32, 0.9, l), 1.0);
}`,
};

// 9-tap gaussian as 5 bilinear taps.
export const BLUR = {
  vertexShader: QUAD,
  fragmentShader: /* glsl */`
uniform sampler2D tSrc; uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += (texture2D(tSrc, vUv + uDir * 1.3846153846).rgb + texture2D(tSrc, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
  c += (texture2D(tSrc, vUv + uDir * 3.2307692308).rgb + texture2D(tSrc, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`,
};

// Low-res scene -> screen: CRT curve, sharp-bilinear upscale, chroma shift, bloom, scanlines, damage and glitch.
export const COMPOSITE = {
  vertexShader: QUAD,
  fragmentShader: /* glsl */`
uniform sampler2D tScene; uniform sampler2D tBloom;
uniform vec2 uSceneRes; uniform vec2 uOutRes; uniform float uTime;
uniform float uGlitch; uniform float uHurt; uniform float uFade; uniform float uAberr; uniform float uBloom; uniform float uCrt;
uniform vec3 uTint; uniform float uTintAmt; uniform float uFlash; uniform float uRewind;
varying vec2 vUv;
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
vec3 scene(vec2 uv) {
  vec2 px = uv * uSceneRes, fl = floor(px), fr = fract(px);
  fr = clamp((fr - 0.5) * (uOutRes.y / uSceneRes.y) + 0.5, 0.0, 1.0);
  return texture2D(tScene, (fl + fr) / uSceneRes).rgb;
}
// This pass runs on every screen pixel, so it is kept lean: two scene fetches, one bloom fetch, no trig in the
// steady state; the glitch, rewind and tint branches are uniform-driven and cost nothing when idle.
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  vec2 uv = (c + c * (c.yx * c.yx) * vec2(0.035, 0.045) * uCrt) * 0.5 + 0.5;
  if (uGlitch > 0.001) {
    float row = floor(uv.y * 54.0), tt = floor(uTime * 24.0);
    uv.x += step(1.0 - uGlitch * 0.55, h1(row + tt * 7.3)) * (h1(row * 3.1 + tt) - 0.5) * 0.09 * uGlitch;
  }
  if (uRewind > 0.001) uv.x += uRewind * 0.012 * sin(uv.y * 90.0 + uTime * 60.0);
  vec3 col = scene(uv);
  col.r = scene(uv + (uv - 0.5) * (0.005 * uCrt + uAberr + uGlitch * 0.02)).r; // red fringe towards the edges
  col += texture2D(tBloom, uv).rgb * uBloom;
  if (uTintAmt > 0.001) col = mix(col, uTint * dot(col, vec3(0.3, 0.55, 0.15)) * 1.5, uTintAmt);
  col *= 1.0 - uCrt * 0.26 * mod(floor(gl_FragCoord.y), 2.0); // scanlines: every other output row
  float v = dot(c, c);
  col *= 1.0 - 0.22 * v;
  col += vec3(0.9, 0.05, 0.08) * uHurt * smoothstep(0.25, 1.6, v) + uFlash;
  col += (h1(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime) - 0.5) * 0.035;
  vec2 m = smoothstep(vec2(0.0), vec2(0.004, 0.006), uv) * smoothstep(vec2(0.0), vec2(0.004, 0.006), 1.0 - uv);
  gl_FragColor = vec4(col * m.x * m.y * uFade, 1.0);
}`,
};
