'use strict';
/* FUNKTION: PENCIL – Striche werden mit Stift oder Pinsel gezogen (Zeichnung oder Text).
   Geometrie liegt als Segmente in Float-Texturen; ein Raster beschleunigt die Suche pro Pixel.
   So bleibt alles auflösungsunabhängig (Kachel-Export, Supersampling, Kamera mit Neigung). */
(() => {
  const MAXK = 160;           // max. Segmente pro Rasterzelle

  const GLSL = `
uniform highp sampler2D uSegT;   // 3 Texel pro Segment
uniform highp sampler2D uCellT;  // (Start, Anzahl) pro Rasterzelle
uniform highp sampler2D uIdxT;   // Segment-Indizes
uniform vec4 uGridB;             // min.xy, Zellgröße, an/aus
uniform vec2 uGridN;
uniform float uHead, uTail, uFade, uW, uIdxW;
uniform vec2 uCamC;
uniform float uCamZ, uCamTilt, uCamYaw;
uniform float uDry, uRough, uSplat, uHalftone, uFlow, uGrainB, uPaper, uSpeck;
uniform vec3 uBg, uInk1, uInk2, uInk3;

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
// Wertrauschen mit Ableitung: (Wert, d/dx, d/dy)
vec3 vnoiseD(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du.x * ((b - a) + k * u.y), du.y * ((c - a) + k * u.x));
}
// Borstenrauschen aus 3 Oktaven (fa quer, fl längs, wt Gewicht).
// Liefert (Wert, Änderung pro Pixel) – damit wird jede Faserkante exakt ~1 px weich, nie verwischt.
// Zu feine Oktaven werden ausgeblendet (kein Flimmern bei kleinen Strichen).
vec2 streakN(float acr, float along, vec3 fa, vec3 fl, vec3 wt, float seed, float w, float W, float pxc){
  float v = 0.0, ws = 0.0; vec2 g = vec2(0.0);
  for (int i = 0; i < 3; i++){
    float k = wt[i] * (1.0 - smoothstep(0.15, 0.4, fa[i] * pxc / w));
    if (k <= 0.0) continue;
    vec3 n = vnoiseD(vec2(acr * fa[i] + seed + float(i) * 17.0, along * fl[i] + float(i) * 5.3));
    v += n.x * k; ws += k;
    g += vec2(n.y * fa[i] / w, n.z * fl[i] / W) * k;
  }
  // ausgeblendete Oktaven zählen als Mittelwert (wie eine Weichzeichnung) -> gleiche Verteilung bei jeder Größe
  float wt0 = wt.x + wt.y + wt.z;
  return vec2((v + (wt0 - ws) * 0.5) / wt0, length(g) / wt0 * pxc);
}
// weiche Schwelle mit pixelgenauer Breite
float cut(float t, vec2 n, float con){
  float v = (n.x - 0.5) * con + 0.5, gw = n.y * con * 0.7 + 0.002;
  return smoothstep(t - gw, t + gw, v);
}
vec3 inkCol(float k){ return k < 0.5 ? uInk1 : (k < 1.5 ? uInk2 : uInk3); }
ivec2 segAt(int i, int j){ return ivec2((i % 1024) * 3 + j, i / 1024); }

// Deckung eines Strichs an Punkt q.
// v = (Bogenlänge, seitlicher Abstand, halbe Breite, Strichlänge) · d = Abstand zur Strichachse
float brush(vec2 q, vec4 v, float d, float sid, float pxc){
  float W = max(uW, 1e-5);
  float s = v.x, w = max(v.z, 1e-6), side = v.y >= 0.0 ? 1.0 : -1.0;
  float x = d / w, acr = v.y / w, along = s / W;
  float prog = clamp(s / max(v.w, 1e-5), 0.0, 1.0);
  float pr = clamp(w / W, 0.0, 1.0);
  float seed = sid * 7.13;
  float aaw = pxc / w;

  // ausgefranste Kante: unruhiger Umriss, Risse am Rand und feine Borstenspuren nach außen
  float en = vnoise(vec2(along * 2.2, side * 5.0 + seed)) * 0.55 + vnoise(vec2(along * 7.0, side * 9.0 + seed + 3.0)) * 0.3
           + vnoise(vec2(along * 19.0, side * 13.0 + seed)) * 0.15;
  float edge = 1.0 - uRough * 0.5 * en;
  float xe = x / edge;
  float a = 1.0 - smoothstep(1.0 - aaw, 1.0 + aaw, xe);
  if (uRough > 0.0){
    vec2 fb = streakN(acr, along, vec3(9.0, 18.0, 36.0), vec3(0.6, 1.4, 3.0), vec3(0.6, 0.3, 0.1), seed, w, W, pxc);
    // Schwelle steigt zum Rand hin: innen geschlossen, außen bleiben nur einzelne Fasern – immer scharf begrenzt
    float zone = smoothstep(1.0 - 0.45 * uRough, 1.0, xe);
    a *= cut(-0.8 + 1.35 * zone, fb, 2.2);
    float hair = cut(0.82 + 1.2 * smoothstep(1.0, 1.0 + 0.3 * uRough, xe), fb, 2.2);
    a = max(a, hair);
  }

  // Raster (Halbton-Punkte in der Fläche des Strichs)
  if (uHalftone > 0.0 && a > 0.0){
    float cs = 0.004 + uHalftone * 0.03;
    vec2 hq = mat2(0.7071, 0.7071, -0.7071, 0.7071) * q / cs;
    float dd = length(fract(hq) - 0.5) * cs;
    float soft = 1.0 - smoothstep(0.3, 1.0, xe);
    float r = cs * (0.22 + 0.24 * soft);
    a *= 1.0 - smoothstep(r - pxc, r + pxc, dd);
  }
  // Trockenpinsel: Lücken zwischen den Borsten, zum Strichende und zum Rand hin trockener
  if (uDry > 0.0 && a > 0.0){
    vec2 br = streakN(acr, along, vec3(5.0, 11.0, 24.0), vec3(0.22, 0.55, 1.3), vec3(0.55, 0.3, 0.15), seed + 31.0, w, W, pxc);
    float dry = uDry * (0.25 + 0.75 * smoothstep(0.2, 1.0, prog)) * (0.55 + 0.6 * xe) * (1.2 - 0.35 * pr);
    a *= cut(dry, br, 2.1);
  }
  // Papierkorn (Bleistift, Kreide)
  if (uGrainB > 0.0 && a > 0.0){
    float o2 = smoothstep(0.0025, 0.0008, pxc);
    float gn = vnoise(q * 650.0) * (1.0 - 0.4 * o2) + vnoise(q * 1700.0 + 7.0) * 0.4 * o2;
    float thr = uGrainB * (0.78 - 0.3 * pr) + 0.12 * x;
    a *= smoothstep(thr - 0.12, thr + 0.12, gn);
  }
  // Spritzer: unregelmäßige Tropfen rund um den Strich
  if (uSplat > 0.0 && x > 0.5){
    vec2 g = vec2(along * 1.1, side * x * 1.6), id = floor(g), fr = fract(g) - 0.5;
    float prob = uSplat * 0.9 * exp(-max(x - 1.0, 0.0) * 0.9 / (0.2 + uSplat));
    if (hash12(id + seed + 11.0) < prob){
      vec2 c = (vec2(hash12(id + seed + 2.1), hash12(id + seed + 4.7)) - 0.5) * 0.7;
      vec2 dd = (fr - c) * vec2(W / 1.1, w / 1.6);
      dd.x *= 0.55 + 0.4 * hash12(id + seed + 6.1);
      float r = (0.03 + 0.12 * pow(hash12(id + seed + 8.3), 2.0)) * W;
      r *= 0.65 + 0.7 * vnoise(q / max(r, 1e-4) * 0.9 + seed);
      a = max(a, 1.0 - smoothstep(r - pxc, r + pxc, length(dd)));
    }
  }
  return a;
}

vec3 effect(vec2 fc, vec2 uv){
  float mn = min(uRes.x, uRes.y);
  vec2 sp = (fc - 0.5 * uRes) / mn;

  // Kamera: Ebene geneigt (Perspektive), gedreht, gezoomt
  const float F = 1.6;
  float ct = cos(uCamTilt), st = sin(uCamTilt);
  float den = F * ct - sp.y * st;
  if (den <= 0.03) return uBg;
  float v = sp.y * F / den;
  float u = sp.x * (F + v * st) / F;
  vec2 pl = vec2(u, v) / uCamZ;
  float cy = cos(uCamYaw), sy = sin(uCamYaw);
  vec2 q = uCamC + vec2(cy * pl.x - sy * pl.y, sy * pl.x + cy * pl.y);
  float pxc = max(length(fwidth(q)) * 0.75, 1e-6);
  float horizon = smoothstep(0.03, 0.12, den);

  // Untergrund: Papierstruktur und Sprenkel
  vec3 col = uBg;
  if (uPaper > 0.0){
    float pa = (vnoise(q * 160.0) - 0.5) * 0.55 + (vnoise(q * 430.0) - 0.5) * 0.45 * smoothstep(0.004, 0.001, pxc);
    col *= 1.0 + pa * uPaper * 0.16;
  }
  if (uSpeck > 0.0){
    const float CS = 0.03;
    vec2 g = q / CS, id = floor(g), f = fract(g) - 0.5;
    if (hash12(id + 17.3) < uSpeck * 0.45){
      vec2 c = (vec2(hash12(id + 1.3), hash12(id + 5.1)) - 0.5) * 0.5;
      float an = hash12(id + 2.9) * 6.283;
      vec2 d = f - c; d = vec2(cos(an) * d.x + sin(an) * d.y, -sin(an) * d.x + cos(an) * d.y);
      d.x *= 1.0 + 2.5 * hash12(id + 4.4);
      float r = (0.03 + 0.3 * pow(hash12(id + 9.7), 3.0)) * (0.7 + 0.6 * vnoise(q * 700.0));
      float a = 1.0 - smoothstep(r * CS - pxc, r * CS + pxc, length(d) * CS);
      col = mix(col, uInk1, a);
    }
  }

  // Striche: pro Strich zählt das nächstgelegene Segment (durchgehende Koordinaten entlang des Strichs)
  vec2 gq = (q - uGridB.xy) / uGridB.z;
  if (uGridB.w > 0.5 && gq.x >= 0.0 && gq.y >= 0.0 && gq.x < uGridN.x && gq.y < uGridN.y){
    vec4 cell = texelFetch(uCellT, ivec2(gq), 0);
    int start = int(cell.x + 0.5), cnt = int(cell.y + 0.5);
    // Form = exakte Vereinigung (kleinster Randabstand); Textur-Koordinaten weich über benachbarte
    // Segmente gemittelt -> keine Stufen in Kurven und Ecken
    float curSid = -1.0, sink = 0.0, bd = 1e9, accW = 0.0;
    vec4 acc = vec4(0.0);
    float reachK = 2.5 * uSplat;
    float kb = max(uW * 0.35, 1e-5);
    for (int k = 0; k <= ${MAXK}; k++){
      bool last = k >= cnt;
      float sid = -2.0;
      vec4 T2 = vec4(0.0);
      int si = 0;
      if (!last){
        int li = start + k;
        si = int(texelFetch(uIdxT, ivec2(li % int(uIdxW), li / int(uIdxW)), 0).r + 0.5);
        T2 = texelFetch(uSegT, segAt(si, 2), 0);
        sid = floor(T2.w / 4.0 + 0.01);
      }
      if (sid != curSid){
        if (bd < 1e8 && accW > 0.0){
          vec4 bv = acc / accW;
          col = mix(col, inkCol(sink), brush(q, bv, bd + bv.z, curSid, pxc) * uFlow * uFade);
        }
        bd = 1e9; accW = 0.0; acc = vec4(0.0); curSid = sid; sink = T2.w - sid * 4.0;
      }
      if (last) break;
      vec4 T1 = texelFetch(uSegT, segAt(si, 1), 0);
      if (T1.z >= uHead || T1.w <= uTail) continue;
      vec4 T0 = texelFetch(uSegT, segAt(si, 0), 0);
      // am Stiftkopf / Abbau-Ende kürzen -> runde Enden
      float dt = max(T1.w - T1.z, 1e-7);
      float f0 = clamp((uTail - T1.z) / dt, 0.0, 1.0), f1 = clamp((uHead - T1.z) / dt, 0.0, 1.0);
      vec2 A = mix(T0.xy, T0.zw, f0), B = mix(T0.xy, T0.zw, f1);
      vec2 ba = B - A, pa = q - A;
      float L2 = dot(ba, ba);
      float hu = L2 > 1e-14 ? dot(pa, ba) / L2 : 0.0;
      float h = clamp(hu, 0.0, 1.0);
      float d = length(pa - ba * h);
      float w = max(mix(mix(T2.x, T2.y, f0), mix(T2.x, T2.y, f1), h), 1e-6);
      float e = d - w;
      if (e > bd + 5.0 * kb || e > w * reachK + 2.0 * pxc) continue;
      // Textur-Koordinaten: entlang (über die Enden hinaus fortgesetzt) und quer – keine Ringe an den Enden
      float lba = sqrt(L2);
      float perp = lba > 1e-7 ? (ba.x * pa.y - ba.y * pa.x) / lba : d;
      float sA = mix(T1.x, T1.y, f0), sB = mix(T1.x, T1.y, f1);
      if (e < bd){ float sc = exp((e - bd) / kb); acc *= sc; accW *= sc; bd = e; }
      float wt = exp(-(e - bd) / kb);
      acc += wt * vec4(mix(sA, sB, h) + (hu - h) * lba, perp, w, T2.z);
      accW += wt;
    }
  }
  return mix(uBg, col, horizon);
}`;

  /* ---------- Werkzeuge ---------- */
  const BRUSHES = [
    { name: 'Bleistift', p: { width: 4.5, taper: 0.3, dry: 0,    rough: 0.1,  splat: 0,    halftone: 0,    press: 0.35, wobble: 0.35, flow: 0.9, grainB: 0.5 } },
    { name: 'Fineliner', p: { width: 4,  taper: 0.06, dry: 0,    rough: 0,    splat: 0,    halftone: 0,    press: 0.05, wobble: 0.15, flow: 1,   grainB: 0 } },
    { name: 'Pinsel',    p: { width: 22, taper: 0.85, dry: 0,    rough: 0.1,  splat: 0.04, halftone: 0,    press: 0.55, wobble: 0.2,  flow: 1,   grainB: 0 } },
    { name: 'Trocken',   p: { width: 80, taper: 0.15, dry: 0.45, rough: 0.6,  splat: 0.35, halftone: 0,    press: 0.3,  wobble: 0.3,  flow: 1,   grainB: 0 } },
    { name: 'Kreide',    p: { width: 22, taper: 0.15, dry: 0.3,  rough: 0.5,  splat: 0.12, halftone: 0,    press: 0.3,  wobble: 0.3,  flow: 0.95, grainB: 0.7 } },
    { name: 'Raster',    p: { width: 80, taper: 0.4,  dry: 0.1,  rough: 0.6,  splat: 0.15, halftone: 0.3,  press: 0.3,  wobble: 0.3,  flow: 1,   grainB: 0 } },
  ];

  const PALETTES = [
    { name: 'Gelb',    c: { bg: '#f5c211', ink1: '#ffffff', ink2: '#1aa3c9', ink3: '#2a2a2a' } },
    { name: 'Papier',  c: { bg: '#f3efe6', ink1: '#25252a', ink2: '#c4412e', ink3: '#3a5f9e' } },
    { name: 'Tafel',   c: { bg: '#1f2a26', ink1: '#f1f1ea', ink2: '#f0c14b', ink3: '#79b4d8' } },
    { name: 'Nacht',   c: { bg: '#0d0d12', ink1: '#ffffff', ink2: '#ff6b4a', ink3: '#8b5cf6' } },
    { name: 'Blau',    c: { bg: '#1747d1', ink1: '#ffffff', ink2: '#ffd24d', ink3: '#0b1d55' } },
  ];

  /* ---------- Hilfen ---------- */
  const smooth01 = t => t * t * (3 - 2 * t);
  // 1D-Wertrauschen 0..1
  const h1 = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const vn1 = x => { const i = Math.floor(x), f = x - i; return h1(i) + (h1(i + 1) - h1(i)) * smooth01(f); };

  // Chaikin-Glättung (Enden bleiben)
  function chaikin(P, it) {
    for (let k = 0; k < it; k++) {
      if (P.length < 3) return P;
      const Q = [P[0]];
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1];
        Q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1], 0.75 * a[2] + 0.25 * b[2]],
               [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1], 0.25 * a[2] + 0.75 * b[2]]);
      }
      Q.push(P[P.length - 1]);
      P = Q;
    }
    return P;
  }
  // gleichmäßig neu abtasten
  function resample(P, sp) {
    const out = [P[0]];
    let acc = 0;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      let L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let t0 = 0;
      while (acc + L * (1 - t0) >= sp) {
        const t = t0 + (sp - acc) / L;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
        t0 = t; acc = 0;
      }
      acc += L * (1 - t0);
    }
    const last = P[P.length - 1], o = out[out.length - 1];
    if (Math.hypot(last[0] - o[0], last[1] - o[1]) > sp * 0.2 || out.length === 1) out.push(last);
    return out;
  }

  // Ecken weich ausrunden (Radius ~ Pinselbreite), Enden bleiben fest – ein breiter Pinsel dreht nicht auf der Stelle
  function roundCorners(P, r) {
    if (r < 1 || P.length < 5) return P;
    for (let it = 0; it < 2; it++) {
      const Q = P.map(p => p.slice());
      for (let i = 1; i < P.length - 1; i++) {
        const k = Math.min(r, i, P.length - 1 - i);
        let sx = 0, sy = 0, sw = 0;
        for (let j = -k; j <= k; j++) { const w = 1 - Math.abs(j) / (k + 1); sx += P[i + j][0] * w; sy += P[i + j][1] * w; sw += w; }
        Q[i][0] = sx / sw; Q[i][1] = sy / sw;
      }
      P = Q;
    }
    return P;
  }

  /* ---------- Quell-Striche im Format-Koordinatensystem ---------- */
  function sourceStrokes(P, ex, ey) {
    let list, fit = 1;
    if (+P.src === 1 || +P.src === 2) {
      const t = +P.src === 1 ? CG.strokes.text(P.text || '', +P.font || 0) : (Array.isArray(P.svgStrokes) ? P.svgStrokes : []);
      if (!t) return null;                                 // wird noch erzeugt
      list = t;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const s of list) for (let i = 0; i < s.p.length; i += 3) { x0 = Math.min(x0, s.p[i]); x1 = Math.max(x1, s.p[i]); y0 = Math.min(y0, s.p[i + 1]); y1 = Math.max(y1, s.p[i + 1]); }
      if (!isFinite(x0)) return [];
      fit = +P.src === 1 ? Math.min(ex * 0.82 / Math.max(x1 - x0, 1e-3), ey * 0.7 / Math.max(y1 - y0, 1e-3))
                         : Math.min(ex * 0.8 / Math.max(x1 - x0, 1e-3), ey * 0.8 / Math.max(y1 - y0, 1e-3));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      list = list.map(s => { const p = s.p.slice(); for (let i = 0; i < p.length; i += 3) { p[i] -= cx; p[i + 1] -= cy; } return { i: s.i, p }; });
    } else list = Array.isArray(P.strokes) ? P.strokes : [];
    const k = fit * P.csize;
    return list.map(s => {
      const pts = [];
      for (let i = 0; i + 2 < s.p.length; i += 3) pts.push([s.p[i] * k + P.cx, s.p[i + 1] * k + P.cy, s.p[i + 2]]);
      return { ink: s.i | 0, pts };
    }).filter(s => s.pts.length);
  }

  /* ---------- Geometrie: Glätten, Breite, Zeitplan, Raster ---------- */
  const strokeIds = new WeakMap(); let strokeIdN = 0;
  const idOf = a => { if (!a || typeof a !== 'object') return 0; if (!strokeIds.has(a)) strokeIds.set(a, ++strokeIdN); return strokeIds.get(a); };
  let G = null;              // aktuelle Geometrie (CPU)

  function geometry(P, aspect) {
    const ex = Math.max(aspect, 1), ey = Math.max(1 / aspect, 1);
    const sig = [+P.src, P.src == 1 ? P.text + '|' + P.font + '|' + !!CG.strokes.text(P.text || '', +P.font || 0) : idOf(P.src == 2 ? P.svgStrokes : P.strokes),
      P.width, P.taper, P.press, P.wobble, P.csize, P.cx, P.cy, P.swing, P.splat, aspect.toFixed(4)].join('|');
    if (G && G.sig === sig) return G;
    const src = sourceStrokes(P, ex, ey);
    if (!src) return G || (G = { sig: 'wait', n: 0, verts: [] });               // Text wird noch erzeugt
    const HW = P.width / 2000;                                                  // halbe Strichbreite
    const sp = Math.min(0.012, Math.max(0.0015, HW * 0.6));
    const strokes = [];
    let total = 0;
    for (const s of src) {
      let pts = s.pts.length === 1 ? [s.pts[0], [s.pts[0][0] + 1e-4, s.pts[0][1], s.pts[0][2]]] : s.pts;
      pts = resample(chaikin(pts, 2), sp);
      pts = roundCorners(pts, Math.min(14, Math.round(HW * 0.8 / sp)));
      // Zittern der Hand: seitlicher Versatz
      if (P.wobble > 0 && pts.length > 2) {
        const seed = strokes.length * 13.7;
        let s0 = 0;
        const amp = P.wobble * (HW * 0.25 + 0.0025);
        const moved = pts.map((p, i) => {
          if (i) s0 += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
          let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
          const o = ((vn1(s0 / 0.09 + seed) - 0.5) * 1.4 + (vn1(s0 / 0.025 + seed + 50) - 0.5) * 0.5) * amp;
          return [p[0] + nx * o, p[1] + ny * o, p[2]];
        });
        pts = moved;
      }
      const sv = [0];
      for (let i = 1; i < pts.length; i++) sv.push(sv[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      strokes.push({ ink: s.ink, pts, s: sv, L: sv[sv.length - 1] });
      total += pts.length;
    }
    // Zeitplan: Strichdauer ~ Länge, Absetzen ~ Weg in der Luft; Schwung = Beschleunigen/Abbremsen
    let T = 0;
    const times = [];
    strokes.forEach((st, k) => {
      if (k) {
        const a = strokes[k - 1].pts[strokes[k - 1].pts.length - 1], b = st.pts[0];
        T += 0.05 + 0.3 * Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
      const dur = 0.04 + Math.pow(st.L, 0.8);
      times.push([T, dur]); T += dur;
    });
    T = Math.max(T, 1e-6);
    const sw = P.swing;
    const verts = [];
    const segs = [];
    let sid = 0;
    strokes.forEach((st, k) => {
      const [t0, dur] = times[k];
      const L = Math.max(st.L, 1e-6);
      const taperLen = Math.min(L * 0.4, HW * 6 + 0.01);
      const seed = k * 3.17;
      const tv = [], wv = [];
      st.pts.forEach((p, i) => {
        const u = st.s[i] / L;
        const e = (1 - sw) * u + sw * smooth01(u);
        tv.push((t0 + dur * e) / T);
        let tp = 1;
        if (P.taper > 0) {
          const tin = smooth01(Math.min(1, st.s[i] / (taperLen * (0.4 + P.taper)))), tout = smooth01(Math.min(1, (L - st.s[i]) / (taperLen * (0.5 + P.taper))));
          tp = 1 - P.taper * 0.9 * (1 - Math.pow(Math.min(tin, tout), 0.6));
        }
        const pv = 1 - P.press * 0.5 * vn1(st.s[i] / (HW * 10 + 0.01) + seed);
        wv.push(HW * Math.max(0.15, p[2]) * tp * pv);
        verts.push(p[0], p[1], tv[i]);
      });
      for (let i = 0; i < st.pts.length - 1; i++) {
        segs.push({ a: st.pts[i], b: st.pts[i + 1], sA: st.s[i], sB: st.s[i + 1], tA: tv[i], tB: tv[i + 1], wA: wv[i], wB: wv[i + 1], L, code: sid * 4 + Math.min(2, Math.max(0, st.ink)) });
      }
      sid++;
    });
    const n = segs.length;
    G = { sig, n, segs, verts, HW };
    if (!n) return G;

    // Raster über die Bounding-Box
    const reachK = 1 + 2.5 * P.splat;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, rmax = 0;
    for (const g of segs) {
      const r = Math.max(g.wA, g.wB) * reachK + 0.004;
      rmax = Math.max(rmax, r);
      x0 = Math.min(x0, g.a[0] - r, g.b[0] - r); x1 = Math.max(x1, g.a[0] + r, g.b[0] + r);
      y0 = Math.min(y0, g.a[1] - r, g.b[1] - r); y1 = Math.max(y1, g.a[1] + r, g.b[1] + r);
    }
    const cs = Math.max(rmax * 1.2, Math.max(x1 - x0, y1 - y0) / 220, 0.004);
    const nx = Math.min(256, Math.ceil((x1 - x0) / cs) + 1), ny = Math.min(256, Math.ceil((y1 - y0) / cs) + 1);
    const cells = Array.from({ length: nx * ny }, () => []);
    segs.forEach((g, i) => {
      const r = Math.max(g.wA, g.wB) * reachK + 0.004;
      const cx0 = Math.max(0, Math.floor((Math.min(g.a[0], g.b[0]) - r - x0) / cs)), cx1 = Math.min(nx - 1, Math.floor((Math.max(g.a[0], g.b[0]) + r - x0) / cs));
      const cy0 = Math.max(0, Math.floor((Math.min(g.a[1], g.b[1]) - r - y0) / cs)), cy1 = Math.min(ny - 1, Math.floor((Math.max(g.a[1], g.b[1]) + r - y0) / cs));
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const c = cells[cy * nx + cx];
        if (c.length < MAXK) c.push(i);
      }
    });
    let m = 0; cells.forEach(c => m += c.length);
    G.grid = { x0, y0, cs, nx, ny, cells, m };
    return G;
  }

  /* ---------- GPU-Daten ---------- */
  let gpu = null;
  function upload(gl, R) {
    if (!gpu || gpu.gl !== gl) gpu = { gl, seg: gl.createTexture(), cell: gl.createTexture(), idx: gl.createTexture(), sig: null, idxW: 1 };
    if (gpu.sig === G.sig) return;
    gpu.sig = G.sig;
    const tex = (t, ifmt, fmt, w, h, data) => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    if (!G.n) { tex(gpu.seg, gl.RGBA32F, gl.RGBA, 1, 1, new Float32Array(4)); return; }
    const n = G.n, sw = Math.min(n, 1024) * 3, sh = Math.ceil(n / 1024);
    const sd = new Float32Array(sw * sh * 4);
    G.segs.forEach((g, i) => {
      const o = ((Math.floor(i / 1024) * sw) + (i % 1024) * 3) * 4;
      sd.set([g.a[0], g.a[1], g.b[0], g.b[1], g.sA, g.sB, g.tA, g.tB, g.wA, g.wB, g.L, g.code], o);
    });
    tex(gpu.seg, gl.RGBA32F, gl.RGBA, sw, sh, sd);
    const { nx, ny, cells, m } = G.grid;
    const cd = new Float32Array(nx * ny * 4);
    const iw = Math.min(4096, R.maxTex), ih = Math.max(1, Math.ceil(m / iw));
    const id = new Float32Array(iw * ih);
    let k = 0;
    cells.forEach((c, i) => { cd[i * 4] = k; cd[i * 4 + 1] = c.length; for (const s of c) id[k++] = s; });
    tex(gpu.cell, gl.RGBA32F, gl.RGBA, nx, ny, cd);
    tex(gpu.idx, gl.R32F, gl.RED, iw, ih, id);
    gpu.idxW = iw;
  }

  /* ---------- Zeitachse des Loops ---------- */
  function timeline(P, phase) {
    const drawEnd = P.drawShare, holdEnd = Math.min(0.97, drawEnd + P.hold);
    let head = Math.min(1, phase / drawEnd), tail = -1, fade = 1;
    if (phase > holdEnd) {
      const u = (phase - holdEnd) / (1 - holdEnd);
      if (+P.outro === 0) fade = 1 - smooth01(u);
      else if (+P.outro === 1) tail = smooth01(u) * 1.0001;
      else head = 1 - smooth01(u);
    }
    return { head: head >= 1 ? 1.0001 : head, tail, fade, drawEnd, holdEnd };
  }

  // Position des Stiftkopfs zur Zeit t (auch in der Luft zwischen Strichen)
  function tipAt(t) {
    const v = G && G.verts;
    if (!v || !v.length) return [0, 0];
    const n = v.length / 3;
    if (t <= v[2]) return [v[0], v[1]];
    if (t >= v[(n - 1) * 3 + 2]) return [v[(n - 1) * 3], v[(n - 1) * 3 + 1]];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (v[mid * 3 + 2] <= t) lo = mid; else hi = mid; }
    const ta = v[lo * 3 + 2], tb = v[hi * 3 + 2], f = tb > ta ? (t - ta) / (tb - ta) : 0;
    return [v[lo * 3] + (v[hi * 3] - v[lo * 3]) * f, v[lo * 3 + 1] + (v[hi * 3 + 1] - v[lo * 3 + 1]) * f];
  }

  /* Kamera: fest auf einen Punkt oder dem Stift folgend; zeitlich geglättet und nahtlos */
  function camera(P, phase) {
    const raw = ph => {
      ph = ((ph % 1) + 1) % 1;
      if (+P.camMode !== 1) return [P.focusX, P.focusY, P.zoom];
      const tl = timeline(P, ph);
      if (ph < tl.drawEnd) { const p = tipAt(Math.min(tl.head, 1)); return [p[0], p[1], P.zoom]; }
      return [0, 0, 1];
    };
    let c;
    if (+P.camMode !== 1) c = raw(phase);
    else {
      const sig = 0.035, N = 24;
      let sx = 0, sy = 0, sz = 0, sw = 0;
      for (let i = -N; i <= N; i++) {
        const o = (i / N) * 2.5 * sig, w = Math.exp(-0.5 * (o / sig) ** 2);
        const r = raw(phase + o);
        sx += r[0] * w; sy += r[1] * w; sz += Math.log(r[2]) * w; sw += w;
      }
      c = [sx / sw, sy / sw, Math.exp(sz / sw)];
    }
    // leichte Handkamera (Bewegung)
    const th = phase * Math.PI * 2, m = P.motion * 0.012;
    c[0] += m * (Math.sin(th) + 0.4 * Math.sin(2 * th + 1.3));
    c[1] += m * (Math.cos(th + 0.6) * 0.7 + 0.3 * Math.sin(3 * th));
    return { cx: c[0], cy: c[1], z: c[2], tilt: P.tilt * Math.PI / 180, yaw: P.yaw * Math.PI / 180 + P.motion * 0.015 * Math.sin(th + 2.0) };
  }

  let lastCam = { cx: 0, cy: 0, z: 1, tilt: 0, yaw: 0 };

  function bind(gl, loc, P, phase, R, res) {
    const aspect = res[0] / res[1];
    geometry(P, aspect);
    upload(gl, R);
    const tl = timeline(P, phase);
    const cam = camera(P, phase);
    lastCam = cam;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, gpu.seg);  gl.uniform1i(loc('uSegT'), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, gpu.cell); gl.uniform1i(loc('uCellT'), 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, gpu.idx);  gl.uniform1i(loc('uIdxT'), 3);
    gl.activeTexture(gl.TEXTURE0);
    const g = G.n ? G.grid : null;
    gl.uniform4f(loc('uGridB'), g ? g.x0 : 0, g ? g.y0 : 0, g ? g.cs : 1, g ? 1 : 0);
    gl.uniform2f(loc('uGridN'), g ? g.nx : 0, g ? g.ny : 0);
    gl.uniform1f(loc('uIdxW'), gpu.idxW);
    gl.uniform1f(loc('uW'), P.width / 2000);
    gl.uniform1f(loc('uHead'), tl.head);
    gl.uniform1f(loc('uTail'), tl.tail);
    gl.uniform1f(loc('uFade'), tl.fade);
    gl.uniform2f(loc('uCamC'), cam.cx, cam.cy);
    gl.uniform1f(loc('uCamZ'), cam.z);
    gl.uniform1f(loc('uCamTilt'), cam.tilt);
    gl.uniform1f(loc('uCamYaw'), cam.yaw);
  }

  /* Bildschirmpunkt (zentriert, Einheit = kürzere Seite) -> Zeichenebene */
  function screenToContent(sp) {
    const c = lastCam, F = 1.6, ct = Math.cos(c.tilt), st = Math.sin(c.tilt);
    const den = F * ct - sp[1] * st;
    if (den <= 0.03) return null;
    const v = sp[1] * F / den, u = sp[0] * (F + v * st) / F;
    const px = u / c.z, py = v / c.z, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    return [c.cx + cy * px - sy * py, c.cy + sy * px + cy * py];
  }

  const pct = v => Math.round(v * 100) + ' %';
  const follow = s => +s.camMode === 1;

  CG.functions.push({
    id: 'pencil', name: 'Pencil', glsl: GLSL, bind, screenToContent, sourceStrokes, BRUSHES,
    overrides: { motion: 0.15, loopLen: 10, grain: 0.05 },
    animParams: [
      { key: 'drawShare', label: 'Zeichnen', min: 0.2, max: 0.95, step: 0.01, def: 0.62, format: pct },
      { key: 'hold', label: 'Halten', min: 0, max: 0.6, step: 0.01, def: 0.2, format: pct },
      { key: 'swing', label: 'Schwung', min: 0, max: 1, step: 0.01, def: 0.6 },
      { key: 'outro', type: 'segment', label: 'Ende', def: 0, keep: true,
        options: [{ v: 0, label: 'Ausblenden' }, { v: 1, label: 'Abbauen' }, { v: 2, label: 'Rückwärts' }] },
    ],
    groups: [
      { id: 'pc-content', title: 'Inhalt',
        custom: b => CG.sketch.content(b), sync: () => CG.sketch.syncContent(),
        vp: { cursor: 'move',
              drag: [{ key: 'cx', axis: 'x', unit: 'content' }, { key: 'cy', axis: 'y', unit: 'content' }],
              wheel: { key: 'csize' }, reset: { cx: 0, cy: 0, csize: 1 } },
        params: [
          { key: 'src', type: 'segment', def: 0, keep: true, options: [{ v: 0, label: 'Zeichnung' }, { v: 1, label: 'Text' }, { v: 2, label: 'SVG' }] },
          { key: 'svgStrokes', hidden: true, keep: true, def: [] },
          { key: 'svgName', hidden: true, keep: true, def: '' },
          { key: 'strokes', hidden: true, keep: true, def: CG.strokes.defaultDrawing() },
          { key: 'text', hidden: true, keep: true, def: 'Hallo' },
          { key: 'font', type: 'segment', def: 0, keep: true, options: CG.strokes.FONTS.map((f, i) => ({ v: i, label: f.label })) },
          { key: 'csize', label: 'Größe', min: 0.2, max: 3, step: 0.01, def: 1, detent: true, keep: true },
          { key: 'cx', hidden: true, keep: true, def: 0 },
          { key: 'cy', hidden: true, keep: true, def: 0 },
        ]},
      { id: 'pc-tool', title: 'Werkzeug',
        pre: b => CG.sketch.brushes(b), sync: () => CG.sketch.syncBrushes(),
        params: [
          { key: 'brush', hidden: true, keep: true, def: 3 },
          { key: 'width', label: 'Breite', min: 1, max: 160, step: 0.5, def: 80 },
          { key: 'taper', label: 'Spitzen', min: 0, max: 1, step: 0.01, def: 0.15 },
          { key: 'dry', u: 'uDry', label: 'Trockenheit', min: 0, max: 1, step: 0.01, def: 0.45 },
          { key: 'rough', u: 'uRough', label: 'Kanten', min: 0, max: 1, step: 0.01, def: 0.6 },
          { key: 'splat', u: 'uSplat', label: 'Spritzer', min: 0, max: 1, step: 0.01, def: 0.35 },
          { key: 'halftone', u: 'uHalftone', label: 'Raster', min: 0, max: 1, step: 0.01, def: 0 },
          { key: 'press', hidden: true, keep: true, def: 0.3 },
          { key: 'wobble', hidden: true, keep: true, def: 0.3 },
          { key: 'flow', u: 'uFlow', hidden: true, keep: true, def: 1 },
          { key: 'grainB', u: 'uGrainB', hidden: true, keep: true, def: 0 },
        ]},
      { id: 'pc-cam', title: 'Kamera',
        vp: { cursor: 'grab',
              drag: [{ key: 'yaw', axis: 'x', k: -0.3 }, { key: 'tilt', axis: 'y', k: -0.25 }],
              wheel: { key: 'zoom' },
              click: pt => { const q = screenToContent(pt); return q ? { focusX: +q[0].toFixed(4), focusY: +q[1].toFixed(4) } : null; },
              reset: { zoom: 1, tilt: 0, yaw: 0, focusX: 0, focusY: 0 } },
        params: [
          { key: 'camMode', type: 'segment', def: 0, keep: true, options: [{ v: 0, label: 'Fest' }, { v: 1, label: 'Stift folgen' }] },
          { key: 'zoom', label: 'Zoom', min: 1, max: 8, step: 0.01, def: 1, keep: true, format: v => (+v).toFixed(1).replace('.', ',') + '×' },
          { key: 'tilt', type: 'angle', wrap: false, min: 0, max: 70, label: 'Neigung', def: 0, keep: true },
          { key: 'yaw', type: 'angle', label: 'Drehung', def: 0, keep: true },
          { key: 'focusX', hidden: true, keep: true, def: 0 },
          { key: 'focusY', hidden: true, keep: true, def: 0 },
        ]},
      { id: 'pc-ground', title: 'Untergrund', params: [
        { key: 'paper', u: 'uPaper', label: 'Papier', min: 0, max: 1, step: 0.01, def: 0.15 },
        { key: 'speck', u: 'uSpeck', label: 'Sprenkel', min: 0, max: 1, step: 0.01, def: 0 },
      ]},
      { id: 'pc-color', title: 'Farbe', palette: true, palettes: PALETTES, params: [
        { key: 'bg',   u: 'uBg',   type: 'color', label: 'Grund',   def: '#f5c211' },
        { key: 'ink1', u: 'uInk1', type: 'color', label: 'Farbe 1', def: '#ffffff' },
        { key: 'ink2', u: 'uInk2', type: 'color', label: 'Farbe 2', def: '#1aa3c9' },
        { key: 'ink3', u: 'uInk3', type: 'color', label: 'Farbe 3', def: '#2a2a2a' },
      ]},
    ],
    presets: [
      { name: 'Standard', p: {} },
      { name: 'Raster', p: { ...BRUSHES[5].p, brush: 5, speck: 0.35 } },
      { name: 'Skizze', p: { ...BRUSHES[0].p, brush: 0, ...PALETTES[1].c, paper: 0.6, camMode: 1, zoom: 2.2, src: 1 } },
      { name: 'Tafel', p: { ...BRUSHES[4].p, brush: 4, ...PALETTES[2].c, paper: 0.5, src: 1, font: 1 } },
      { name: 'Kamerafahrt', p: { camMode: 1, zoom: 2.6, tilt: 38, yaw: 12, motion: 0.3, loopLen: 14 } },
      { name: 'Pinselschrift', p: { ...BRUSHES[2].p, brush: 2, ...PALETTES[3].c, src: 1, font: 0, outro: 1 } },
    ],
  });
})();
