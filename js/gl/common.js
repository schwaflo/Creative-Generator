'use strict';
/* Gemeinsame GLSL-Bausteine (WebGL2 / GLSL ES 3.0).
   Jede Funktion liefert:  vec3 effect(vec2 fc, vec2 uv)
   Zeit läuft auf einem Kreis (cos, sin) * uMotion durch 4D-Rauschen
   -> Phase 0 und 1 sind identisch = nahtloser Loop. */
CG.glsl = {};

CG.glsl.vert = `#version 300 es
in vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

CG.glsl.head = `
precision highp float;
uniform vec2 uRes;      // volle Ausgabeauflösung
uniform vec2 uOffset;   // Kachel-Offset (große Exporte)
uniform float uPhase;   // 0..1 Position im Loop
uniform float uMotion;  // Bewegungsintensität (Radius des Zeitkreises)
uniform float uSS;      // Supersampling-Faktor (Export)
uniform float uBright, uContrast, uSat, uTemp, uGrain, uVignette;
// Bild-Ebene (Textur mit vormultipliziertem Alpha)
uniform sampler2D uImg;
uniform float uImgOn, uImgAspect, uImgTexH, uImgOverlay;
uniform float uImgX, uImgY, uImgScale, uImgRot, uImgOpacity, uImgBlend;
out vec4 outColor;

/* Bild an Position p (zentriert, Einheit = kürzere Bildseite). lodBias > 0 = unschärfer.
   Liefert vormultiplizierte Farbe; außerhalb des Bildes transparent, Ränder geglättet. */
vec4 layerAt(vec2 p, float lodBias){
  if (uImgOn < 0.5) return vec4(0.0);
  vec2 q = p - vec2(uImgX, uImgY);
  float c = cos(uImgRot), s = sin(uImgRot);
  q = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
  vec2 size = vec2(uImgScale * uImgAspect, uImgScale);
  vec2 uv = q / size + 0.5;
  float mn = min(uRes.x, uRes.y);
  vec2 edgePx = min(uv, 1.0 - uv) * size * mn;
  float inside = clamp(min(edgePx.x, edgePx.y) + 0.5, 0.0, 1.0);
  if (inside <= 0.0) return vec4(0.0);
  float lod = log2(max(uImgTexH / (uImgScale * mn), 1.0)) + lodBias;
  return textureLod(uImg, clamp(uv, 0.0, 1.0), lod) * inside;
}

`;

/* 4D Simplex Noise – Ashima Arts / Stefan Gustavson (MIT) */
CG.glsl.noise = `
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
float mod289(float x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
float permute(float x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float taylorInvSqrt(float r){ return 1.79284291400159 - 0.85373472095314 * r; }
vec4 grad4(float j, vec4 ip){
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;
  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz*2.0 - 1.0) * s.www;
  return p;
}
float snoise(vec4 v){
  const vec4 C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
  vec4 i = floor(v + dot(v, vec4(0.309016994374947451)));
  vec4 x0 = v - i + dot(i, C.xxxx);
  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  vec4 i3 = clamp(i0, 0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);
  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;
  i = mod289(i);
  float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = permute(permute(permute(permute(
              i.w + vec4(i1.w, i2.w, i3.w, 1.0))
            + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
            + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
            + i.x + vec4(i1.x, i2.x, i3.x, 1.0));
  vec4 ip = vec4(1.0/294.0, 1.0/49.0, 1.0/7.0, 0.0);
  vec4 p0 = grad4(j0, ip);
  vec4 p1 = grad4(j1.x, ip);
  vec4 p2 = grad4(j1.y, ip);
  vec4 p3 = grad4(j1.z, ip);
  vec4 p4 = grad4(j1.w, ip);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  p4 *= taylorInvSqrt(dot(p4,p4));
  vec3 m0 = max(0.6 - vec3(dot(x0,x0), dot(x1,x1), dot(x2,x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3,x3), dot(x4,x4)), 0.0);
  m0 = m0 * m0; m1 = m1 * m1;
  return 49.0 * (dot(m0*m0, vec3(dot(p0,x0), dot(p1,x1), dot(p2,x2)))
               + dot(m1*m1, vec2(dot(p3,x3), dot(p4,x4))));
}

const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
// Fraktales Rauschen; z = Position auf dem Zeitkreis
float fbm(vec2 x, vec2 z, float oct){
  float a = 0.5, s = 0.0, n = 0.0;
  vec4 p = vec4(x, z);
  for (int i = 0; i < 8; i++){
    if (float(i) >= oct) break;
    s += a * snoise(p); n += a;
    p.xy = ROT * p.xy * 2.03 + vec2(3.1, 1.7);
    p.zw = p.zw * 1.3 + vec2(5.3, 2.9);
    a *= 0.5;
  }
  return s / n;
}
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
// Begrenzt die Schärfe einer pow(1-|sin|)-Linie auf mind. ~1 px Breite (gegen Treppen/Punktlinien)
float aaSharp(float n, float fw){ return min(n, 0.5 / max(fw, 1e-6)); }
vec2 seedOffset(float s){ return vec2(fract(s * 0.6180339) * 97.0, fract(s * 0.3819660) * 89.0); }
`;

CG.glsl.main = `
void main(){
  vec2 fc = gl_FragCoord.xy + uOffset;
  vec2 uv = fc / uRes;
  vec3 col = effect(fc, uv);
  // Bild-Ebene über dem Effekt (bei Funktionen, die das Bild nicht selbst verarbeiten)
  if (uImgOverlay > 0.5 && uImgOn > 0.5){
    vec4 L = layerAt((fc - 0.5 * uRes) / min(uRes.x, uRes.y), 0.0) * uImgOpacity;
    vec3 st = L.a > 0.001 ? L.rgb / L.a : vec3(0.0);
    vec3 b = uImgBlend < 0.5 ? st : (uImgBlend < 1.5 ? col * st : 1.0 - (1.0 - col) * (1.0 - st));
    col = mix(col, b, L.a);
  }
  // Finish
  col *= vec3(1.0 + 0.10 * uTemp, 1.0 + 0.015 * uTemp, 1.0 - 0.12 * uTemp);
  col = (col - 0.5) * uContrast + 0.5;
  col *= uBright;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);
  float mn = min(uRes.x, uRes.y);
  float v = smoothstep(0.35, 1.05, length((fc - 0.5 * uRes) / mn) * 1.15);
  col *= 1.0 - uVignette * v;
  col += (hash12(floor(fc / max(uSS, 1.0)) + floor(uPhase * 997.0) * 13.7) - 0.5) * uGrain * 0.12;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

CG.glsl.build = fn => '#version 300 es\n' + CG.glsl.head + CG.glsl.noise + fn.glsl + CG.glsl.main;
