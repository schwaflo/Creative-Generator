'use strict';
/* FUNKTION: FEUER – seidige Flammenschleier (Domain-Warping + Konturfilamente) */
(() => {
  const GLSL = `
uniform float uScale, uWarp, uOctaves, uStretch, uFlow, uSeed;
uniform float uStrandAmt, uStrandDensity, uStrandSharp, uFine;
uniform float uDir, uCoverage, uSoftness, uEdgeTurb;
uniform float uHeat, uHaze, uSmoke;
uniform vec3 uBg, uSmokeCol, uC1, uC2, uC3, uC4;

vec3 ramp(float t){
  vec3 c = mix(uBg, uC1, smoothstep(0.02, 0.17, t));
  c = mix(c, uC2, smoothstep(0.1, 0.36, t));
  c = mix(c, uC3, smoothstep(0.45, 0.75, t));
  c = mix(c, uC4, smoothstep(0.72, 0.98, t));
  return c;
}

vec3 effect(vec2 fc, vec2 uv){
  float mn = min(uRes.x, uRes.y);
  vec2 p = (fc - 0.5 * uRes) / mn;

  // Strömungsrichtung + Streckung
  vec2 fd = vec2(cos(uFlow), sin(uFlow));
  vec2 fp = vec2(dot(p, vec2(-fd.y, fd.x)), dot(p, fd) / uStretch) * uScale;
  vec2 sd = seedOffset(uSeed);

  float th = 6.28318530718 * uPhase;
  vec2 z = vec2(cos(th), sin(th)) * uMotion;

  // Domain Warping – glattes Warp-Feld ergibt lange, fließende Linien
  vec2 q = vec2(fbm(fp + sd,                  z,                  2.0),
                fbm(fp + sd + vec2(5.2, 1.3), z + vec2(3.3, 7.1), 2.0));
  vec2 r = vec2(fbm(fp + uWarp*q + sd + vec2(1.7, 9.2), z*1.25 + vec2(1.1, 4.3), 3.0),
                fbm(fp + uWarp*q + sd + vec2(8.3, 2.8), z*1.25 + vec2(6.2, 2.4), 3.0));
  vec2 w = fp + uWarp * r + sd;
  float f   = fbm(w, z, max(uOctaves - 2.0, 1.0));
  float fd2 = fbm(w * 2.3 + 4.0, z * 1.4, uOctaves);
  float bm  = smoothstep(-0.4, 0.35, fbm(fp * 0.8 + q * 1.5 + 11.0, z, 2.0));
  float hz  = smoothstep(-0.5, 0.6, fbm(fp * 0.6 + r * 0.5 + 23.0, z * 0.8, 3.0));

  // Filamente = feine Höhenlinien des verwirbelten Feldes (+ weicher Schein)
  float k = uStrandDensity;
  float x1 = f * k + q.x * 0.4;
  float x2 = f * k * 2.1 + fd2 * 0.9 + r.y;
  float c1 = 1.0 - abs(sin(x1 * 3.14159265));
  float c2 = 1.0 - abs(sin(x2 * 3.14159265));
  // Antialiasing: zu feine Linien werden breiter & entsprechend dunkler statt pixelig
  float n1 = aaSharp(uStrandSharp,       fwidth(x1) * 3.14159265);
  float n2 = aaSharp(uStrandSharp * 1.6, fwidth(x2) * 3.14159265);
  float s1 = pow(c1, n1) * (n1 / uStrandSharp)         + 0.3 * pow(c1, max(uStrandSharp * 0.15, 1.5));
  float s2 = pow(c2, n2) * (n2 / (uStrandSharp * 1.6)) + 0.2 * pow(c2, max(uStrandSharp * 0.25, 1.5));
  float strands = (s1 + uFine * s2 * 0.7) * (0.2 + 0.8 * bm);

  // Komposition
  vec2 dd = vec2(cos(uDir), sin(uDir));
  vec2 pc = (uv - 0.5) * 2.0;
  float e = dot(pc, dd) * 0.75 + (uCoverage * 2.0 - 1.0) + (f + 0.3 * fd2) * uEdgeTurb;
  float sw = uSoftness * 0.5 + 0.01;
  float mask = smoothstep(-sw, sw, e);
  float deep = smoothstep(0.0, sw * 2.0 + 0.6, e);

  // Grundlicht
  float H = mask * uHaze * (0.34 + 0.22 * deep) * (0.55 + 0.9 * hz);
  H += uHeat * deep * hz * hz * 0.7;
  vec3 col = ramp(clamp(H, 0.0, 1.0));

  // Rauch im freien Bereich
  col = mix(col, uSmokeCol, clamp((1.0 - mask) * uSmoke * (s1 * 0.55 + s2 * uFine * 0.3), 0.0, 1.0));

  // Filamente, eingefärbt nach lokaler Hitze
  float L = uStrandAmt * strands;
  float heatHere = clamp(0.24 + 0.42 * mask + 0.3 * deep * hz * uHeat + 0.35 * L, 0.0, 1.0);
  col = mix(col, ramp(heatHere), clamp(L * (0.15 + 0.85 * mask), 0.0, 1.0));

  // Glutkerne
  col = mix(col, uC4, clamp(uHeat * deep * hz * strands * 0.55, 0.0, 1.0));
  return col;
}`;

  const PALETTES = [
    { name: 'Gold & Rosé',  c: { bg: '#f7f3f1', smokeCol: '#b8adb5', c1: '#e9a2b6', c2: '#f3a04c', c3: '#ffd24d', c4: '#fffbec' } },
    { name: 'Violett & Gold', c: { bg: '#f5f0f4', smokeCol: '#a99aab', c1: '#b06aa6', c2: '#e0703f', c3: '#ffc94a', c4: '#fff6e0' } },
    { name: 'Glut',         c: { bg: '#120806', smokeCol: '#3b2b27', c1: '#6e1a10', c2: '#d9471a', c3: '#ffad2b', c4: '#fff2c2' } },
    { name: 'Nacht-Gold',   c: { bg: '#0d0a13', smokeCol: '#2c2338', c1: '#5a2758', c2: '#d27238', c3: '#ffd068', c4: '#fffaf0' } },
    { name: 'Blaue Flamme', c: { bg: '#f1f4f9', smokeCol: '#a7b1c2', c1: '#a4c0ff', c2: '#3f6ef0', c3: '#7fe2ff', c4: '#ffffff' } },
    { name: 'Smaragd',      c: { bg: '#071210', smokeCol: '#23332f', c1: '#0f4a3c', c2: '#1fa37a', c3: '#9cf2c4', c4: '#f4fff8' } },
    { name: 'Monochrom',    c: { bg: '#f4f4f4', smokeCol: '#9a9a9a', c1: '#cfcfcf', c2: '#8c8c8c', c3: '#454545', c4: '#0e0e0e' } },
  ];

  CG.functions.push({
    id: 'fire', name: 'Feuer', glsl: GLSL,
    groups: [
      { id: 'fire-comp', title: 'Komposition', params: [
        { key: 'dir', u: 'uDir', type: 'angle', label: 'Position', def: 335, keep: true },
        { key: 'coverage', u: 'uCoverage', label: 'Ausdehnung', min: 0, max: 1, step: 0.01, def: 0.55, keep: true },
        { key: 'softness', u: 'uSoftness', label: 'Übergang', min: 0.02, max: 2, step: 0.01, def: 1.1 },
        { key: 'edgeTurb', u: 'uEdgeTurb', label: 'Randturbulenz', min: 0, max: 3, step: 0.01, def: 0.6 },
      ]},
      { id: 'fire-struct', title: 'Struktur', params: [
        { key: 'size', u: 'uScale', map: v => 1 / v, label: 'Maßstab', min: 0.2, max: 2.5, step: 0.01, def: 0.85 },
        { key: 'warp', u: 'uWarp', label: 'Verwirbelung', min: 0, max: 4, step: 0.01, def: 1.2 },
        { key: 'stretch', u: 'uStretch', label: 'Streckung', min: 1, max: 4, step: 0.01, def: 2.6 },
        { key: 'flow', u: 'uFlow', type: 'angle', label: 'Strömung', def: 105 },
        { key: 'octaves', u: 'uOctaves', type: 'step', label: 'Detailtiefe', min: 1, max: 8, step: 1, def: 4 },
        { key: 'seed', u: 'uSeed', label: 'Seed', min: 0, max: 999, step: 1, def: 7, action: 'random' },
      ]},
      { id: 'fire-fil', title: 'Filamente', params: [
        { key: 'strandAmt', u: 'uStrandAmt', label: 'Intensität', min: 0, max: 2, step: 0.01, def: 1.2 },
        { key: 'strandDensity', u: 'uStrandDensity', label: 'Dichte', min: 1, max: 14, step: 0.1, def: 5 },
        { key: 'strandSharp', u: 'uStrandSharp', label: 'Schärfe', min: 2, max: 60, step: 0.5, def: 14 },
        { key: 'fine', u: 'uFine', label: 'Sekundärebene', min: 0, max: 1.5, step: 0.01, def: 0.5 },
      ]},
      { id: 'fire-light', title: 'Licht', params: [
        { key: 'heat', u: 'uHeat', label: 'Glut', min: 0, max: 2, step: 0.01, def: 1.3 },
        { key: 'haze', u: 'uHaze', label: 'Lichtschleier', min: 0, max: 2, step: 0.01, def: 0.7 },
        { key: 'smoke', u: 'uSmoke', label: 'Rauch', min: 0, max: 1, step: 0.01, def: 0.35 },
      ]},
      { id: 'fire-color', title: 'Farbe', palette: true, palettes: PALETTES, params: [
        { key: 'bg',       u: 'uBg',       type: 'color', label: 'Grund',  def: '#f7f3f1' },
        { key: 'smokeCol', u: 'uSmokeCol', type: 'color', label: 'Rauch',  def: '#b8adb5' },
        { key: 'c1',       u: 'uC1',       type: 'color', label: 'Rand',   def: '#e9a2b6' },
        { key: 'c2',       u: 'uC2',       type: 'color', label: 'Flamme', def: '#f3a04c' },
        { key: 'c3',       u: 'uC3',       type: 'color', label: 'Licht',  def: '#ffd24d' },
        { key: 'c4',       u: 'uC4',       type: 'color', label: 'Kern',   def: '#fffbec' },
      ]},
    ],
    presets: [
      { name: 'Standard', p: {} },
      { name: 'Seidenschleier', p: { size: 1.1, warp: 1.1, stretch: 2.2, strandAmt: 1.3, strandDensity: 6, strandSharp: 28, fine: 0.9, haze: 0.55, heat: 0.6, smoke: 0.5 } },
      { name: 'Lodern', p: { size: 0.45, warp: 2.4, octaves: 6, stretch: 2.6, flow: 90, strandAmt: 1.1, strandDensity: 5, strandSharp: 10, heat: 1.4, haze: 1.0, coverage: 0.62, dir: 270, motion: 1.1, loopLen: 8 } },
      { name: 'Glimmen', p: { size: 0.8, warp: 0.9, strandAmt: 0.5, strandSharp: 8, haze: 1.2, heat: 0.9, softness: 1.4, motion: 0.35, loopLen: 20, smoke: 0.15 } },
      { name: 'Nachtfeuer', p: { ...PALETTES[3].c, coverage: 0.62, heat: 1.0, smoke: 0.25, grain: 0.25, vignette: 0.35 } },
      { name: 'Violett', p: { ...PALETTES[1].c, dir: 315, coverage: 0.5, strandDensity: 5, strandSharp: 20 } },
    ],
  });
})();
