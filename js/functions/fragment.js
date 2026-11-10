'use strict';
/* FUNKTION: FRAGMENT – das Motiv zerfällt zu einer Seite hin in Kacheln:
   versetzte und skalierte Blöcke, Lücken, Dreieckshälften, Mosaik, Unschärfe. */
(() => {
  const GLSL = `
uniform float uCell, uSubdiv, uSeed;
uniform float uDir, uCoverage, uSoftness, uEdgeTurb;
uniform float uDisplace, uScatter, uMissing, uTri, uMosaic, uTileScale;
uniform float uBlur, uFade, uEdges, uFlicker;
uniform vec3 uBg, uEdgeCol;

// Motiv: hochgeladenes Bild oder – ohne Bild – eine neutrale Platzhalter-Silhouette
vec4 subject(vec2 p, float lod){
  if (uImgOn > 0.5) return layerAt(p, lod);
  vec2 q = (p - vec2(-0.02, -0.04)) * vec2(1.25, 0.95);
  float a = 1.0 - smoothstep(0.30, 0.305, length(q));
  vec3 c = mix(vec3(0.13, 0.11, 0.10), vec3(0.62, 0.50, 0.43), smoothstep(-0.35, 0.35, p.y + p.x * 0.4));
  return vec4(c * a, a);
}

vec3 effect(vec2 fc, vec2 uv){
  float mn = min(uRes.x, uRes.y);
  vec2 p = (fc - 0.5 * uRes) / mn;
  vec2 ext = uRes / mn;
  vec2 sd = seedOffset(uSeed);
  float th = 6.28318530718 * uPhase;
  vec2 z = vec2(cos(th), sin(th)) * uMotion;

  // Raster mit zufälliger Unterteilung (bis zu 3 Ebenen)
  float S = uCell;
  vec2 cid = floor(p / S);
  float r = hash12(cid + sd);
  if (r < uSubdiv){
    S *= 0.5; cid = floor(p / S); r = hash12(cid * 1.73 + sd + 13.1);
    if (r < uSubdiv * 0.7){ S *= 0.5; cid = floor(p / S); r = hash12(cid * 2.31 + sd + 7.7); }
  }
  vec2 cc = (cid + 0.5) * S;
  vec2 l = (p - cc) / S + 0.5;
  float r2 = hash12(cid + sd + 41.3), r3 = hash12(cid + sd + 77.7);
  float r4 = hash12(cid + sd + 5.9),  r5 = hash12(cid + sd + 91.1);

  // Zerfallsmaske (an der Kachelmitte ausgewertet -> ganze Kacheln)
  vec2 dd = vec2(cos(uDir), sin(uDir));
  float n = fbm(cc * 2.5 + sd, z * 0.5, 3.0);
  float e = dot(cc / ext * 2.0, dd) * 0.75 + (uCoverage * 2.0 - 1.0) + n * uEdgeTurb;
  float sw = uSoftness * 0.5 + 0.01;
  float d = smoothstep(-sw, sw, e);

  // Flackern pro Kachel – läuft über den Zeitkreis, daher nahtlos
  float tn  = snoise(vec4(cid * 0.71 + sd, z * 1.7));
  float tn2 = snoise(vec4(cid * 0.53 + sd + 19.0, z * 1.7));
  bool hit = d >= r + tn * uFlicker * 0.25;

  vec2 sp = p;
  float lod = 0.0, vis = 1.0, fade = 0.0;
  if (hit){
    vec2 off = -dd * (0.25 + r2) * uDisplace * 0.25 * d
             + (vec2(r3, r4) - 0.5) * uScatter * 0.2
             + vec2(tn, tn2) * uFlicker * S * 0.6;
    float zoom = 1.0 + (r5 - 0.5) * uTileScale * 1.5;
    sp = cc + (p - cc) * zoom + off;
    if (r4 < uMosaic * d){ sp = cc + off; lod += log2(max(S * mn, 1.0)); }   // einfarbige Kachel
    lod += uBlur * r2 * 5.0;
    fade = uFade * r3 * d;
    if (r2 < uMissing * d) vis = 0.0;                                         // Lücke
    if (r5 < uTri * d){                                                       // nur eine Dreieckshälfte
      float diag = r3 < 0.5 ? (l.x + l.y - 1.0) : (l.y - l.x);
      if (hash12(cid + sd + 3.3) < 0.5) diag = -diag;
      float aa = 1.0 / max(S * mn, 1.0);
      vis *= smoothstep(-aa, aa, diag);
    }
  }

  vec4 s = subject(sp, lod) * vis;
  vec3 col = uBg * (1.0 - s.a) + s.rgb;
  col = mix(col, uBg, fade);

  // feine Kachelkanten
  if (hit && uEdges > 0.0){
    vec2 bd = min(l, 1.0 - l) * S * mn;
    float ed = 1.0 - smoothstep(0.0, mn / 1000.0 + 0.6, min(bd.x, bd.y));
    col = mix(col, uEdgeCol, ed * uEdges * s.a);
  }
  return col;
}`;

  const PALETTES = [
    { name: 'Hellgrau', c: { bg: '#e4e4e4', edgeCol: '#ffffff' } },
    { name: 'Weiß',     c: { bg: '#f6f6f6', edgeCol: '#ffffff' } },
    { name: 'Papier',   c: { bg: '#ebe5da', edgeCol: '#ffffff' } },
    { name: 'Nebel',    c: { bg: '#dfe6ee', edgeCol: '#ffffff' } },
    { name: 'Schwarz',  c: { bg: '#0b0b0c', edgeCol: '#ffffff' } },
  ];

  CG.functions.push({
    id: 'fragment', name: 'Fragment', glsl: GLSL, usesImage: true,
    overrides: { motion: 0.4, loopLen: 8, grain: 0.06 },
    animParams: [
      { key: 'flicker', u: 'uFlicker', label: 'Flackern', min: 0, max: 1, step: 0.01, def: 0.35 },
    ],
    groups: [
      { id: 'fr-comp', title: 'Komposition', params: [
        { key: 'dir', u: 'uDir', type: 'angle', label: 'Richtung', def: 0, keep: true },
        { key: 'coverage', u: 'uCoverage', label: 'Ausdehnung', min: 0, max: 1, step: 0.01, def: 0.45, keep: true },
        { key: 'softness', u: 'uSoftness', label: 'Übergang', min: 0.02, max: 2, step: 0.01, def: 0.6 },
        { key: 'edgeTurb', u: 'uEdgeTurb', label: 'Randturbulenz', min: 0, max: 2, step: 0.01, def: 0.5 },
      ]},
      { id: 'fr-grid', title: 'Raster', params: [
        { key: 'cell', u: 'uCell', label: 'Kachelgröße', min: 0.01, max: 0.2, step: 0.001, def: 0.05 },
        { key: 'subdiv', u: 'uSubdiv', label: 'Unterteilung', min: 0, max: 1, step: 0.01, def: 0.45 },
        { key: 'seed', u: 'uSeed', label: 'Seed', min: 0, max: 999, step: 1, def: 3, action: 'random' },
      ]},
      { id: 'fr-break', title: 'Zerfall', params: [
        { key: 'displace', u: 'uDisplace', label: 'Versatz', min: 0, max: 2, step: 0.01, def: 0.6 },
        { key: 'scatter', u: 'uScatter', label: 'Streuung', min: 0, max: 1, step: 0.01, def: 0.3 },
        { key: 'missing', u: 'uMissing', label: 'Lücken', min: 0, max: 1, step: 0.01, def: 0.35 },
        { key: 'tri', u: 'uTri', label: 'Dreiecke', min: 0, max: 1, step: 0.01, def: 0.25 },
        { key: 'mosaic', u: 'uMosaic', label: 'Mosaik', min: 0, max: 1, step: 0.01, def: 0.2 },
        { key: 'tileScale', u: 'uTileScale', label: 'Skalierung', min: 0, max: 1, step: 0.01, def: 0.2 },
      ]},
      { id: 'fr-look', title: 'Look', params: [
        { key: 'blur', u: 'uBlur', label: 'Unschärfe', min: 0, max: 1, step: 0.01, def: 0.25 },
        { key: 'fade', u: 'uFade', label: 'Ausbleichen', min: 0, max: 1, step: 0.01, def: 0.35 },
        { key: 'edges', u: 'uEdges', label: 'Kanten', min: 0, max: 1, step: 0.01, def: 0 },
      ]},
      { id: 'fr-color', title: 'Farbe', palette: true, palettes: PALETTES, params: [
        { key: 'bg',      u: 'uBg',      type: 'color', label: 'Grund',  def: '#e4e4e4' },
        { key: 'edgeCol', u: 'uEdgeCol', type: 'color', label: 'Kanten', def: '#ffffff' },
      ]},
    ],
    presets: [
      { name: 'Standard', p: {} },
      { name: 'Dreiecke', p: { cell: 0.032, subdiv: 0.15, tri: 0.85, mosaic: 0, missing: 0.15, displace: 0.35, scatter: 0.1, blur: 0, fade: 0.15, dir: 340, coverage: 0.5 } },
      { name: 'Blöcke', p: { cell: 0.11, subdiv: 0.75, tri: 0, mosaic: 0.1, missing: 0.3, displace: 0.9, scatter: 0.55, blur: 0.55, fade: 0.5, tileScale: 0.35, dir: 180, coverage: 0.45 } },
      { name: 'Mosaik', p: { cell: 0.04, subdiv: 0.5, mosaic: 0.85, tri: 0.1, missing: 0.2, displace: 0.2, blur: 0, edges: 0.5 } },
      { name: 'Glitch', p: { cell: 0.06, subdiv: 0.6, flicker: 0.9, displace: 1.3, scatter: 0.6, missing: 0.25, motion: 0.8, loopLen: 4 } },
    ],
  });
})();
