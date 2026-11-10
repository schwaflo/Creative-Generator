'use strict';
/* FUNKTION: GROUNDDATA – topografische Höhenlinien auf einem 3D-Gelände,
   optional mit Leuchtpfaden (Impulse entlang der Linien oder Linienaufbau). */
(() => {
  const GLSL = `
uniform float uScale, uWarp, uOctaves, uSeed;
uniform float uTilt, uYaw, uRelief;
uniform float uLevels, uLineWidth, uGlow, uIndex;
uniform float uShade, uDof, uFog;
const float FOCUS = 1.4;
const float LIGHT_DIR = 2.1;
uniform float uDrift;
uniform float uPathMode, uPathDir, uPathSpeed, uPathFreq, uPathLen, uPathSpread, uPathGlow, uPathBase;
uniform vec3 uBg, uTerrain, uLine, uPathCol;

float terrain(vec2 Q, vec2 z, float oct){
  vec2 w = Q + uWarp * vec2(fbm(Q * 0.6 + vec2(3.1, 7.7), z * 0.8, 2.0),
                            fbm(Q * 0.6 + vec2(8.7, 1.9), z * 0.8 + vec2(2.3, 5.1), 2.0));
  return fbm(w, z, oct);
}

vec3 effect(vec2 fc, vec2 uv){
  float mn = min(uRes.x, uRes.y);
  float px = mn / 1000.0;                 // Referenz: Breiten in "Pixel bei 1000 px"
  vec2 p = (fc - 0.5 * uRes) / mn;

  // Kamera über einer Ebene (Neigung 0 = Draufsicht)
  float ca = cos(uTilt), sa = sin(uTilt);
  vec3 d = vec3(p.x, p.y * sa - ca, p.y * ca + sa);
  float den = -d.y;
  float ground = smoothstep(0.0, 0.05, den);
  den = max(den, 0.015);
  float t = 1.0 / den;                    // Entfernung
  vec2 P = vec2(d.x, d.z) * t;

  float cy = cos(uYaw), sy = sin(uYaw);
  mat2 Ry = mat2(cy, sy, -sy, cy);
  vec2 sd = seedOffset(uSeed);
  float th = 6.28318530718 * uPhase;
  vec2 z = vec2(cos(th), sin(th)) * uMotion;

  // Relief: Strahl gegen das Höhenfeld verfolgen (Raymarching + Bisektion).
  // s = Anteil des Weges bis zur Grundebene; Strahlhöhe über der Ebene = 1 - s.
  float s = 1.0;
  if (uRelief > 0.001){
    float hm = 0.8 * uRelief;
    float lo = 1.0 - hm, hi = 1.0 + hm;
    float ds = (hi - lo) / 28.0;
    float a = lo;
    bool hit = false;
    for (int i = 1; i <= 28; i++){
      float b = lo + ds * float(i);
      if (1.0 - b <= uRelief * terrain((Ry * (P * b)) * uScale + sd, z, 3.0)){ lo = a; hi = b; hit = true; break; }
      a = b;
    }
    if (hit){
      for (int j = 0; j < 6; j++){
        float m = 0.5 * (lo + hi);
        if (1.0 - m <= uRelief * terrain((Ry * (P * m)) * uScale + sd, z, 3.0)) hi = m; else lo = m;
      }
    }
    s = hi;
  }
  t *= s;
  vec2 Qr = Ry * (P * s);
  vec2 W = Qr * uScale + sd;
  float h = terrain(W, z, uOctaves);
  // Gradient des Höhenfelds (für Linienbreite und Schattierung)
  const float E = 0.004;
  vec2 G = vec2(terrain(W + vec2(E, 0.0), z, uOctaves) - h,
                terrain(W + vec2(0.0, E), z, uOctaves) - h) / E;

  // Höhenlinien
  float v = h * uLevels + uPhase * uDrift;          // ganzzahliger Fluss = nahtlos
  // Exakte Bildschirm-Ableitung von v (statt fwidth, das nur pro 2x2-Block
  // rechnet und dadurch Punktmuster erzeugt). Berücksichtigt Perspektive & Relief.
  vec2 dPdx = vec2(1.0 / den, 0.0);
  vec2 dPdy = vec2(p.x * sa, 1.0) / (den * den);
  float corr = max(abs(1.0 + uRelief * uScale * dot(G, Ry * P)), 0.05);
  vec2 gv = uLevels * uScale * s * vec2(dot(G, Ry * dPdx), dot(G, Ry * dPdy)) / corr;
  float fw = max(length(gv) / mn, 1e-5);
  float idx = floor(v + 0.5);
  float dN = abs(v - idx) / (fw * px);               // Abstand in Referenzpixeln
  float isIdx = 1.0 - step(0.5, mod(idx, 5.0));
  float wN = uLineWidth * (1.0 + isIdx * uIndex * 1.3) * mix(1.0, 1.0 / t, 0.45);
  float blurN = uDof * abs(log(t / FOCUS)) * 9.0;
  float aaN = 1.0 / px;
  float core = (1.0 - smoothstep(wN * 0.5, wN * 0.5 + aaN + blurN, dN)) / (1.0 + blurN * 0.12);
  float halo = exp(-dN / (3.0 + wN + blurN * 1.5)) * uGlow * 0.5;
  float dens = 1.0 - smoothstep(0.2, 0.55, fw * px);  // gegen Moiré bei sehr dichten Linien
  float lineBase = (core * (1.0 + isIdx * uIndex * 0.4) + halo) * dens;

  // Geländeschattierung: Normale aus dem Höhenfeld
  vec3 n = normalize(vec3(-G * uScale * max(uRelief, 0.15) * 0.6, 1.0));
  vec3 Ld = normalize(vec3(cos(LIGHT_DIR), sin(LIGHT_DIR), 0.7));
  float diff = clamp(dot(n, Ld), 0.0, 1.0);
  float shade = clamp(diff * (0.55 + 0.9 * h), 0.0, 1.2);
  vec3 col = mix(uBg, uTerrain, clamp(uShade * shade, 0.0, 1.0));
  float lit = mix(1.0, 0.45 + 0.9 * diff, 0.5);

  // Leuchtpfad
  float baseVis = 1.0, pl = 0.0;
  if (uPathMode > 0.5){
    float rnd = hash11(idx * 1.37 + 3.1);
    vec2 pd = vec2(cos(uPathDir), sin(uPathDir));
    if (uPathMode < 1.5){
      // Impulse wandern entlang der Linien
      float gq = dot(Qr, pd) * uPathFreq * 3.0;
      float pr = fract(gq - uPhase * uPathSpeed + rnd);
      pl = pow(smoothstep(1.0 - uPathLen, 0.94, pr), 2.0) * smoothstep(1.0, 0.94, pr);   // weicher Kopf, keine harte Kante
      baseVis = uPathBase;
    } else {
      // Linien bauen sich auf, halten und blenden aus
      float gs = dot(uv - 0.5, pd) + 0.5 + (rnd - 0.5) * uPathSpread;
      float front = mix(-0.4 - uPathSpread * 0.5, 1.4 + uPathSpread * 0.5, smoothstep(0.0, 0.72, uPhase));
      float fade = 1.0 - smoothstep(0.86, 1.0, uPhase);
      float rev = smoothstep(gs - 0.004, gs + 0.004, front);
      baseVis = rev * fade;
      pl = exp(-max(front - gs, 0.0) * 14.0) * rev * fade;
    }
  }
  col = mix(col, uLine, clamp(lineBase * lit * baseVis, 0.0, 1.0));
  float P1 = (core * 1.2 + halo * 0.9) * dens * pl * uPathGlow;
  col = mix(col, uPathCol, clamp(P1, 0.0, 1.0));

  // Dunst & Horizont
  float fogF = 1.0 - exp(-max(t - 1.0, 0.0) * uFog * 0.8);
  col = mix(col, uBg, fogF);
  return mix(uBg, col, ground);
}`;

  const PALETTES = [
    { name: 'Graphit',    c: { bg: '#050505', terrain: '#3c3c3c', line: '#e6e6e6', pathCol: '#ffffff' } },
    { name: 'Gold',       c: { bg: '#07060a', terrain: '#2e261a', line: '#e3c58a', pathCol: '#fff1c9' } },
    { name: 'Papier',     c: { bg: '#efe9df', terrain: '#d2c8b6', line: '#3a3128', pathCol: '#c2562a' } },
    { name: 'Blueprint',  c: { bg: '#0b2340', terrain: '#17406b', line: '#a6c8ff', pathCol: '#ffffff' } },
    { name: 'Gebetshaus', c: { bg: '#170d17', terrain: '#4a2342', line: '#f3a04c', pathCol: '#ffd24d' } },
    { name: 'Neon',       c: { bg: '#05060a', terrain: '#141a26', line: '#3ef2c3', pathCol: '#f04fd8' } },
  ];

  const pathOn = s => s.pathMode > 0;
  const pulse = s => s.pathMode === 1;
  const build = s => s.pathMode === 2;

  CG.functions.push({
    id: 'grounddata', name: 'Grounddata', glsl: GLSL,
    overrides: { motion: 0.3, loopLen: 16, grain: 0.1, vignette: 0.35 },
    animParams: [
      { key: 'drift', u: 'uDrift', type: 'step', label: 'Linienfluss', min: -4, max: 4, step: 1, def: 0, detent: true,
        format: v => (v > 0 ? '+' : '') + v },
    ],
    groups: [
      { id: 'gd-cam', title: 'Kamera',
        vp: { cursor: 'grab', drag: [{ key: 'yaw', axis: 'x', k: -0.3 }, { key: 'tilt', axis: 'y', k: -0.25 }] },
        params: [
        { key: 'tilt', u: 'uTilt', type: 'angle', wrap: false, min: 0, max: 72, label: 'Neigung', def: 52, keep: true },
        { key: 'yaw', u: 'uYaw', type: 'angle', label: 'Drehung', def: 25 },
        { key: 'relief', u: 'uRelief', label: 'Relief', min: 0, max: 0.8, step: 0.01, def: 0.35 },
      ]},
      { id: 'gd-terrain', title: 'Gelände', params: [
        { key: 'gsize', u: 'uScale', map: v => 1 / v, label: 'Maßstab', min: 0.3, max: 4, step: 0.01, def: 2.2 },
        { key: 'gwarp', u: 'uWarp', label: 'Verformung', min: 0, max: 2.5, step: 0.01, def: 0.4 },
        { key: 'goct', u: 'uOctaves', type: 'step', label: 'Detailtiefe', min: 1, max: 7, step: 1, def: 4 },
        { key: 'gseed', u: 'uSeed', label: 'Seed', min: 0, max: 999, step: 1, def: 12, action: 'random' },
      ]},
      { id: 'gd-lines', title: 'Höhenlinien', params: [
        { key: 'levels', u: 'uLevels', label: 'Anzahl', min: 6, max: 90, step: 1, def: 40 },
        { key: 'lineWidth', u: 'uLineWidth', label: 'Stärke', min: 0.3, max: 6, step: 0.05, def: 1.3 },
        { key: 'glow', u: 'uGlow', label: 'Glow', min: 0, max: 2, step: 0.01, def: 0.6 },
        { key: 'index', u: 'uIndex', label: 'Zähllinien', min: 0, max: 1, step: 0.01, def: 0.4 },
      ]},
      { id: 'gd-path', title: 'Leuchtpfad', params: [
        { key: 'pathMode', u: 'uPathMode', type: 'segment', label: 'Modus', def: 0, keep: true,
          options: [{ v: 0, label: 'Aus' }, { v: 1, label: 'Impulse' }, { v: 2, label: 'Aufbau' }] },
        { key: 'pathDir', u: 'uPathDir', type: 'angle', label: 'Richtung', def: 0, showIf: pathOn },
        { key: 'pathSpeed', u: 'uPathSpeed', type: 'step', label: 'Tempo', min: 1, max: 6, step: 1, def: 2, showIf: pulse,
          format: v => v + '×' },
        { key: 'pathFreq', u: 'uPathFreq', label: 'Dichte', min: 0.2, max: 4, step: 0.01, def: 1.2, showIf: pulse },
        { key: 'pathLen', u: 'uPathLen', label: 'Schweif', min: 0.05, max: 0.9, step: 0.01, def: 0.35, showIf: pulse },
        { key: 'pathSpread', u: 'uPathSpread', label: 'Versatz', min: 0, max: 1, step: 0.01, def: 0.35, showIf: build },
        { key: 'pathGlow', u: 'uPathGlow', label: 'Leuchtkraft', min: 0, max: 3, step: 0.01, def: 1.5, showIf: pathOn },
        { key: 'pathBase', u: 'uPathBase', label: 'Grundlinien', min: 0, max: 1, step: 0.01, def: 0.25, showIf: pulse },
      ]},
      { id: 'gd-light', title: 'Licht & Tiefe', params: [
        { key: 'shade', u: 'uShade', label: 'Schattierung', min: 0, max: 1, step: 0.01, def: 0.7 },
        { key: 'dof', u: 'uDof', label: 'Tiefenunschärfe', min: 0, max: 1, step: 0.01, def: 0.55 },
        { key: 'fog', u: 'uFog', label: 'Dunst', min: 0, max: 1, step: 0.01, def: 0.5 },
      ]},
      { id: 'gd-color', title: 'Farbe', palette: true, palettes: PALETTES, params: [
        { key: 'bg',      u: 'uBg',      type: 'color', label: 'Grund',   def: '#050505' },
        { key: 'terrain', u: 'uTerrain', type: 'color', label: 'Gelände', def: '#3c3c3c' },
        { key: 'line',    u: 'uLine',    type: 'color', label: 'Linien',  def: '#e6e6e6' },
        { key: 'pathCol', u: 'uPathCol', type: 'color', label: 'Pfad',    def: '#ffffff' },
      ]},
    ],
    presets: [
      { name: 'Standard', p: {} },
      { name: 'Karte', p: { tilt: 0, relief: 0, dof: 0, fog: 0, shade: 0.35, levels: 30, lineWidth: 1.4, vignette: 0, ...PALETTES[2].c } },
      { name: 'Weite', p: { tilt: 66, gsize: 1.3, levels: 48, fog: 0.6, dof: 0.5, relief: 0.35 } },
      { name: 'Datenstrom', p: { ...PALETTES[5].c, pathMode: 1, pathSpeed: 2, pathBase: 0.2, glow: 0.8 } },
      { name: 'Aufbau', p: { ...PALETTES[1].c, pathMode: 2, pathSpread: 0.4, loopLen: 12 } },
      { name: 'Fluss', p: { drift: 1, levels: 42, motion: 0.2 } },
    ],
  });
})();
