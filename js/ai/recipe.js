'use strict';
/* KI: Rezept-Generatoren – das Modell ist Art Director, nicht Programmierer.
   Das Modell beschreibt das Referenzbild als Rezept: Hintergrund, Kamera, Licht und 1–5 Ebenen aus festen Typen
   (Netz, Zellen, Blasen, Fasern, Nebel …) mit Werten 0..1. Die App baut daraus selbst einen Shader aus geprüften
   Bausteinen (LIB) und gleicht Zahlen und Farben danach automatisch per Bildvergleich an die Referenz an (fit).
   Ergebnis ist ein normaler Shader-Generator (params + code) – Regler, Presets, Export laufen wie bisher. */
CG.ai = CG.ai || {};
CG.ai.recipe = (() => {
  const MAX_LAYERS = 5;

  /* ---------- Ebenen-Typen ----------
     call: GLSL-Ausdruck, der die Ebene berechnet (x = Ebenen-Koordinate, cs = Elementgröße, z = Zeitkreis)
     warp: wie stark „chaos“ die Koordinaten zusätzlich verzieht · d: Vorgaben, falls das Modell nichts angibt */
  const TYPES = {
    mesh:     { label: 'Netz',     warp: 0.6,  call: n => `lMesh(x, cs, ${n}_fill, ${n}_chaos)`,
                d: { size: 0.5, fill: 0.35, chaos: 0.7, detail: 0.3, relief: 0.7, gloss: 0.3, glass: 0.0, soft: 0.05, opacity: 1 } },
    cells:    { label: 'Zellen',   warp: 0.5,  call: n => `lCells(x, cs, ${n}_fill, ${n}_chaos)`,
                d: { size: 0.5, fill: 0.8, chaos: 0.7, detail: 0.2, relief: 0.7, gloss: 0.3, glass: 0.0, soft: 0.05, opacity: 1 } },
    blobs:    { label: 'Blasen',   warp: 0.5,  call: n => `lDots(x, cs, ${n}_fill, 0.3 + 0.7 * ${n}_chaos, ${n}_chaos, 0.18, 1.0)`,
                d: { size: 0.55, fill: 0.55, chaos: 0.7, detail: 0.1, relief: 0.8, gloss: 0.6, glass: 0.3, soft: 0.05, opacity: 1 } },
    dots:     { label: 'Punkte',   warp: 0.3,  call: n => `lDots(x, cs, ${n}_fill * 0.8, ${n}_chaos, ${n}_chaos * 0.5, 0.02, 1.0)`,
                d: { size: 0.3, fill: 0.5, chaos: 0.0, detail: 0, relief: 0.1, gloss: 0, glass: 0, soft: 0.02, opacity: 1 } },
    fibers:   { label: 'Fasern',   warp: 0.3,  call: n => `lFibers(x, cs, ${n}_fill, ${n}_chaos, z)`,
                d: { size: 0.35, fill: 0.4, chaos: 0.5, detail: 0.2, relief: 0.6, gloss: 0.3, glass: 0, soft: 0.05, opacity: 1 } },
    contours: { label: 'Höhenlinien', warp: 0.4, call: n => `lContours(x, cs, ${n}_fill, ${n}_chaos, z, c.px / cs)`,
                d: { size: 0.5, fill: 0.2, chaos: 0.4, detail: 0, relief: 0.2, gloss: 0, glass: 0, soft: 0.02, opacity: 1 } },
    stripes:  { label: 'Streifen', warp: 0.0,  call: n => `lStripes(x, cs, ${n}_fill, ${n}_chaos)`,
                d: { size: 0.4, fill: 0.5, chaos: 0.0, detail: 0, relief: 0.1, gloss: 0, glass: 0, soft: 0.02, opacity: 1 } },
    rings:    { label: 'Ringe',    warp: 0.35, noSeed: true, call: n => `lRings(x, cs, ${n}_fill, ${n}_chaos)`,
                d: { size: 0.4, fill: 0.4, chaos: 0.1, detail: 0, relief: 0.2, gloss: 0, glass: 0, soft: 0.02, opacity: 1 } },
    fog:      { label: 'Nebel',    warp: 0.6,  call: n => `lFog(x, cs, ${n}_fill, z)`,
                d: { size: 0.7, fill: 0.5, chaos: 0.5, detail: 0, relief: 0.15, gloss: 0, glass: 0, soft: 0.3, opacity: 0.7 } },
    fluid:    { label: 'Fluid',    warp: 0.0,  call: n => `lFluid(x, cs, ${n}_fill, ${n}_chaos, z)`,
                d: { size: 0.7, fill: 0.5, chaos: 0.6, detail: 0, relief: 0.3, gloss: 0.2, glass: 0, soft: 0.0, opacity: 1 } },
    facets:   { label: 'Kristall', warp: 0.3,  call: n => `lFacets(x, cs, ${n}_fill, ${n}_chaos)`,
                d: { size: 0.5, fill: 0.4, chaos: 0.8, detail: 0, relief: 0.6, gloss: 0.4, glass: 0, soft: 0.0, opacity: 1 } },
    bokeh:    { label: 'Lichter',  warp: 0.0,  call: n => `lBokeh(x, cs, ${n}_fill)`, blend: 'add',
                d: { size: 0.55, fill: 0.5, chaos: 1, detail: 0, relief: 0, gloss: 0, glass: 0.3, soft: 0.25, opacity: 0.5 } },
  };
  const TYPE_IDS = Object.keys(TYPES);
  const BLENDS = ['normal', 'add', 'multiply', 'screen'];
  const SOLID = ['mesh', 'cells', 'blobs', 'fibers', 'facets', 'stripes', 'rings', 'contours'];
  const MOTIONS = ['still', 'flow', 'drift', 'pulse'];
  const MOTION_LABELS = ['Still', 'Fließen', 'Treiben', 'Pulsieren'];
  const LOOK = ['size', 'fill', 'chaos', 'detail', 'relief', 'gloss', 'glass', 'soft', 'opacity'];
  const LOOK_LABELS = { size: 'Größe', fill: 'Fülle', chaos: 'Unregelmäßigkeit', detail: 'Detail', relief: 'Relief', gloss: 'Glanz', glass: 'Glas', soft: 'Weichheit', opacity: 'Deckkraft' };

  /* ---------- Antwort-Schema für das Modell (Reihenfolge der Felder = Reihenfolge im JSON) ---------- */
  const str = { type: 'string' }, num = { type: 'number' };
  const SCHEMA = { type: 'object', properties: {
      title: str, notes: str,
      background: { type: 'object', properties: { top: str, bottom: str, glow: str, glowX: num, glowY: num, glowSize: num, glowStrength: num }, required: ['top', 'bottom'] },
      camera: { type: 'object', properties: { tilt: num, roll: num, zoom: num, focus: num, blur: num, haze: num } },
      light: { type: 'object', properties: { angle: num } },
      layers: { type: 'array', items: { type: 'object', properties: {
          type: { type: 'string', enum: TYPE_IDS }, colorA: str, colorB: str,
          size: num, fill: num, chaos: num, detail: num, relief: num, gloss: num, glass: num, soft: num, opacity: num, angle: num,
          blend: { type: 'string', enum: BLENDS }, motion: { type: 'string', enum: MOTIONS }, move: num, speed: num },
        required: ['type', 'colorA', 'colorB'] } },
    }, required: ['title', 'notes', 'background', 'camera', 'layers'] };

  /* ---------- Rezept säubern: alles Fehlende/Unlesbare bekommt Vorgaben, nichts führt zu einem Fehler ---------- */
  const hex = (v, d) => CG.ai.schema.normHex(v) || d;
  const n01 = (v, d, lo = 0, hi = 1) => { const x = typeof v === 'string' ? parseFloat(v) : +v; return v == null || !isFinite(x) ? d : Math.min(hi, Math.max(lo, x)); };
  const r2 = v => Math.round(v * 100) / 100;

  function normalize(raw) {
    const j = raw && typeof raw === 'object' ? raw : {};
    const b = j.background || {}, c = j.camera || {}, l = j.light || {};
    const top = hex(b.top, '#20232b'), bottom = hex(b.bottom, top);
    const out = {
      title: String(j.title || 'KI-Generator').slice(0, 60), notes: String(j.notes || '').slice(0, 4000),
      background: { top, bottom, angle: Math.round(n01(b.angle, 0, -180, 180)), glow: hex(b.glow, top), glowX: n01(b.glowX, 0.5), glowY: n01(b.glowY, 0.3), glowSize: n01(b.glowSize, 0.5), glowStrength: n01(b.glowStrength, b.glow ? 0.5 : 0) },
      camera: { tilt: n01(c.tilt, 0), roll: n01(c.roll, 0, -180, 180), zoom: n01(c.zoom, 0.5), focus: n01(c.focus, 0.5), blur: n01(c.blur, 0), haze: n01(c.haze, 0) },
      light: { angle: n01(l.angle, 120, 0, 360) },
      layers: [],
    };
    for (const y of Array.isArray(j.layers) ? j.layers : []) {
      if (!y || typeof y !== 'object' || out.layers.length >= MAX_LAYERS) continue;
      const type = TYPE_IDS.includes(y.type) ? y.type : TYPE_IDS.find(t => String(y.type || '').toLowerCase().includes(t)) || null;
      if (!type) continue;
      const T = TYPES[type], colorA = hex(y.colorA, '#d8d8e0');
      const L = { type, colorA, colorB: hex(y.colorB, colorA) };
      LOOK.forEach(k => { L[k] = r2(n01(y[k], T.d[k])); });
      L.angle = Math.round(n01(y.angle, 0, 0, 360));
      // feste Körper decken immer normal – aufhellende Mischungen sind nur für Licht, Nebel, Flüssigkeit und Punkte sinnvoll
      L.blend = SOLID.includes(type) ? 'normal' : BLENDS.includes(y.blend) ? y.blend : T.blend || 'normal';
      L.motion = MOTIONS.includes(y.motion) ? y.motion : 'flow';
      L.move = r2(n01(y.move, 0.4)); L.speed = Math.round(n01(y.speed, 1, 1, 3));
      out.layers.push(L);
    }
    if (!out.layers.length) out.layers.push(normalize({ layers: [{ type: 'fog', colorA: '#c8c8d0', colorB: '#8088a0' }] }).layers[0]);
    return out;
  }

  /* ---------- Rezept -> Regler (Parameter-Schema der App) ---------- */
  const R01 = (id, label, def, group) => ({ id, label, type: 'range', min: 0, max: 1, step: 0.01, default: r2(def), group });
  function toParams(rc) {
    const b = rc.background, c = rc.camera, P = [
      { id: 'bg1', label: 'Hintergrund oben', type: 'color', default: b.top },
      { id: 'bg2', label: 'Hintergrund unten', type: 'color', default: b.bottom },
      { id: 'glow', label: 'Lichtschein', type: 'color', default: b.glow },
      { id: 'bgangle', label: 'Verlauf Richtung', type: 'range', min: -180, max: 180, step: 1, default: b.angle || 0, group: 'Licht' },
      R01('tilt', 'Neigung', c.tilt, 'Kamera'),
      { id: 'roll', label: 'Drehung', type: 'range', min: -180, max: 180, step: 1, default: Math.round(c.roll), group: 'Kamera' },
      R01('zoom', 'Zoom', c.zoom, 'Kamera'), R01('focus', 'Fokus', c.focus, 'Kamera'),
      R01('blur', 'Tiefenunschärfe', c.blur, 'Kamera'), R01('haze', 'Dunst', c.haze, 'Kamera'),
      { id: 'seed', label: 'Seed', type: 'seed', default: 7, group: 'Kamera' },
      { id: 'light', label: 'Lichtrichtung', type: 'range', min: 0, max: 360, step: 1, default: Math.round(rc.light.angle), group: 'Licht' },
      R01('glowx', 'Schein X', b.glowX, 'Licht'), R01('glowy', 'Schein Y', b.glowY, 'Licht'),
      R01('glowsize', 'Schein Größe', b.glowSize, 'Licht'), R01('glowamt', 'Schein Stärke', b.glowStrength, 'Licht'),
    ];
    rc.layers.forEach((L, i) => {
      const n = 'e' + (i + 1), name = TYPES[L.type].label, group = `${i + 1} · ${name}`;
      P.push({ id: n + '_a', label: `${name} ${i + 1} hell`, type: 'color', default: L.colorA },
             { id: n + '_b', label: `${name} ${i + 1} dunkel`, type: 'color', default: L.colorB });
      LOOK.forEach(k => P.push(R01(`${n}_${k}`, LOOK_LABELS[k], L[k], group)));
      P.push({ id: n + '_angle', label: 'Winkel', type: 'range', min: 0, max: 360, step: 1, default: L.angle, group },
             { id: n + '_motion', label: 'Bewegung', type: 'select', options: MOTION_LABELS, default: MOTION_LABELS[MOTIONS.indexOf(L.motion)], group },
             R01(n + '_move', 'Bewegungsstärke', L.move, group),
             { id: n + '_speed', label: 'Tempo', type: 'range', min: 1, max: 3, step: 1, default: L.speed, group });
    });
    return P;
  }

  // angeglichene Reglerwerte zurück ins Rezept (das Modell sieht in der nächsten Runde die echte Fassung)
  function withParams(rc, params) {
    const v = {}; params.forEach(p => { v[p.id] = p.default; });
    const o = JSON.parse(JSON.stringify(rc)), b = o.background, c = o.camera;
    Object.assign(b, { top: v.bg1, bottom: v.bg2, angle: v.bgangle, glow: v.glow, glowX: v.glowx, glowY: v.glowy, glowSize: v.glowsize, glowStrength: v.glowamt });
    Object.assign(c, { tilt: v.tilt, roll: v.roll, zoom: v.zoom, focus: v.focus, blur: v.blur, haze: v.haze });
    o.light.angle = v.light;
    o.layers.forEach((L, i) => {
      const n = 'e' + (i + 1);
      L.colorA = v[n + '_a']; L.colorB = v[n + '_b'];
      LOOK.forEach(k => { L[k] = v[`${n}_${k}`]; });
      L.angle = v[n + '_angle'];
    });
    return o;
  }

  const describe = rc => rc.layers.map(L => TYPES[L.type].label).join(' + ');

  /* ---------- Shader-Bausteine (GLSL) ----------
     Hilfen aus der App: snoise, fbm(x, zeitkreis, oktaven), hash12, hash11, seedOffset, TAU, smin, rot. */
  const LIB = `
struct Cam { vec2 q; float px; float w; float bl; };
struct Lay { float d; float h; float tone; float es; };

vec2 rh22(vec2 p){ vec3 a = fract(p.xyx * vec3(0.1031, 0.1030, 0.0973)); a += dot(a, a.yzx + 33.33); return fract((a.xx + a.yz) * a.zy); }
float rvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y); }
// Kuppelprofil: 0 am Rand, 1 in der Mitte (d < 0 innen, r = halbe Breite)
float rdome(float d, float r){ float k = clamp(-d / max(r, 1e-5), 0.0, 1.0); return 1.0 - (1.0 - k) * (1.0 - k); }

// Kamera: geneigte Fläche mit Perspektive; w = Entfernung relativ zur Schärfeebene, bl = Unschärfe
Cam rcam(vec2 p, float tilt, float roll, float zoom, float focus, float blur){
  Cam c; vec2 r = rot(radians(roll)) * p;
  // Neigung auf die Bildhöhe bezogen: bei tilt = 1 ist der obere Rand viermal so weit entfernt wie die Bildmitte
  float hh = 0.5 * uRes.y / min(uRes.x, uRes.y);
  float k = tilt * 0.75 / hh;
  float w = 1.0 / max(1.0 - k * r.y, 0.2);
  float fw = 1.0 / max(1.0 - k * (focus - 0.5) * 2.0 * hh, 0.2);
  c.q = r * w / exp2(mix(-1.5, 1.5, zoom));
  c.w = w / fw;
  c.px = max(max(length(dFdx(c.q)), length(dFdy(c.q))), 1e-6);
  c.bl = blur * 0.09 * abs(log(c.w)) * c.px * min(uRes.x, uRes.y);
  return c; }

vec3 rback(vec2 uv, vec2 p, vec3 top, vec3 bot, vec3 glow, vec2 gp, float gs, float gi, float ang){
  vec2 dir = vec2(sin(radians(ang)), cos(radians(ang)));
  vec3 col = mix(bot, top, smoothstep(0.0, 1.0, 0.5 + dot(p * min(uRes.x, uRes.y) / uRes, dir)));
  vec2 g = (vec2(gp.x, 1.0 - gp.y) - 0.5) * uRes / min(uRes.x, uRes.y);
  float d = length(p - g), s = 0.08 + 0.9 * gs;
  return mix(col, glow, gi * exp(-d * d / (s * s)));
}

// Zeitkreis für fließende Bewegung (nahtloser Loop)
vec2 rz(float mode, float amt, float spd, float t){
  float a = TAU * t * max(1.0, floor(spd + 0.5));
  float fl = (mode > 0.5 && mode < 1.5) ? amt : 0.0;
  return vec2(cos(a), sin(a)) * (0.12 + 0.55 * fl) * step(0.001, fl); }

// Ebenen-Koordinate: Größe, Winkel, Seed, Verzerrung, Bewegung
vec2 rco(Cam c, float cs, float ang, float seed, float warp, float mode, float amt, float spd, float t){
  float a = TAU * t * max(1.0, floor(spd + 0.5));
  vec2 x = rot(radians(ang)) * c.q / cs;
  if (mode > 2.5) x *= 1.0 + 0.1 * amt * sin(a);
  x += seedOffset(seed);
  if (mode > 1.5 && mode < 2.5) x += amt * 0.5 * vec2(cos(a), sin(a));
  float fl = (mode > 0.5 && mode < 1.5) ? amt : 0.0;
  float wa = warp * 0.8 + fl * 0.22;
  vec2 z = rz(mode, amt, spd, t);
  x += wa * vec2(fbm(x * 0.37 + 3.1, z, 3.0), fbm(x * 0.37 + 19.7, z + 4.3, 3.0));
  return x; }

vec2 rpt(vec2 cell, float jit){ return vec2(0.25 + 0.5 * mod(cell.y, 2.0), 0.5) + jit * 0.9 * (rh22(cell) - 0.5); }
// Voronoi: x = weicher Abstand zur Zellgrenze, y = Zufallswert der Zelle, z = Abstand zum Zellkern
vec3 rvoro(vec2 x, float jit, float k){
  vec2 n = floor(x), f = fract(x), mg = vec2(0.0), mr = vec2(0.0); float md = 64.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++){
    vec2 g = vec2(float(i), float(j)); vec2 r = g + rpt(n + g, jit) - f; float d = dot(r, r);
    if (d < md){ md = d; mr = r; mg = g; } }
  float ed = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++){
    vec2 g = mg + vec2(float(i), float(j)); vec2 r = g + rpt(n + g, jit) - f;
    if (dot(mr - r, mr - r) > 1e-5) ed = smin(ed, dot(0.5 * (mr + r), normalize(r - mr)), k); }
  return vec3(ed, hash12(n + mg + 7.7), sqrt(md)); }

Lay lMesh(vec2 x, float cs, float fill, float chaos){
  vec3 v = rvoro(x, mix(0.12, 1.0, chaos), 0.22);
  float th = mix(0.03, 0.4, fill) * (0.8 + 0.4 * rvn(x * 0.7 + 3.0));
  Lay s; s.d = (v.x - th) * cs; s.h = rdome(s.d, th * cs); s.tone = 0.65 * s.h + 0.35 * rvn(x * 0.6 + 1.7); s.es = 0.0; return s; }

Lay lCells(vec2 x, float cs, float fill, float chaos){
  vec3 v = rvoro(x, mix(0.12, 1.0, chaos), 0.12);
  float gap = mix(0.3, 0.012, fill);
  Lay s; s.d = (gap - v.x) * cs; s.h = rdome(s.d, max(0.5 - gap, 0.05) * cs * 0.8); s.tone = 0.55 * s.h + 0.45 * v.y; s.es = 0.0; return s; }

// verstreute Kreise; k = Verschmelzen, keep = Anteil der besetzten Plätze
Lay lDots(vec2 x, float cs, float fill, float jit, float var, float k, float keep){
  vec2 n = floor(x), f = fract(x); float d = 8.0, rr = 0.2, tn = 0.5, best = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++){
    vec2 g = vec2(float(i), float(j)), cell = n + g; vec2 hh = rh22(cell); float h1 = hash12(cell + 3.3);
    if (h1 > keep) continue;
    vec2 r = g + 0.5 + jit * 0.9 * (hh - 0.5) - f;
    float rad = mix(0.08, 0.52, fill) * (1.0 - var * 0.7 * hh.x);
    float di = length(r) - rad;
    if (di < best){ best = di; rr = rad; tn = h1 / max(keep, 0.01); }
    d = smin(d, di, k); }
  Lay s; s.d = d * cs; s.h = rdome(s.d, rr * cs); s.tone = 0.6 * s.h + 0.4 * tn; s.es = 0.0; return s; }

Lay lBokeh(vec2 x, float cs, float fill){
  Lay s = lDots(x, cs, fill, 1.0, 0.8, 0.02, 0.45);
  s.tone = 1.0 - 0.5 * s.h; s.h = 0.5; s.es = cs * 0.06; return s; }

Lay lFibers(vec2 x, float cs, float fill, float chaos, vec2 z){
  float v = x.y + (0.3 + 1.6 * chaos) * fbm(x * vec2(0.18, 0.45) + 11.0, z, 3.0);
  float id = floor(v), c = abs(fract(v) - 0.5);
  float th = mix(0.04, 0.5, fill) * (0.55 + 0.9 * rvn(vec2(x.x * 0.35, id * 7.3)));
  Lay s; s.d = (c - th) * cs * 0.8; s.h = rdome(s.d, th * cs * 0.8); s.tone = 0.5 * s.h + 0.5 * hash11(id * 1.37 + 0.5); s.es = 0.0; return s; }

Lay lContours(vec2 x, float cs, float fill, float chaos, vec2 z, float px){
  float v = fbm(x * 0.33 + 5.0, z, 3.0 + 2.0 * chaos) * (2.5 + 3.0 * chaos);
  float g = max(length(vec2(dFdx(v), dFdy(v))) / max(px, 1e-6), 0.08);
  float c = abs(fract(v) - 0.5), th = 0.5 * mix(0.06, 0.9, fill);
  Lay s; s.d = (c - th) / g * cs; s.h = rdome(s.d, th / g * cs); s.tone = 0.5 * s.h + 0.5 * hash11(floor(v) * 0.73 + 4.0); s.es = 0.0; return s; }

Lay lStripes(vec2 x, float cs, float fill, float chaos){
  float v = x.y + chaos * 0.45 * sin(x.x * 0.9 + 1.3 * sin(x.y * 0.31));
  float c = abs(fract(v) - 0.5), th = 0.5 * mix(0.05, 0.95, fill);
  Lay s; s.d = (c - th) * cs; s.h = rdome(s.d, th * cs); s.tone = 0.5 * s.h + 0.5 * hash11(floor(v) * 0.61 + 2.0); s.es = 0.0; return s; }

Lay lRings(vec2 x, float cs, float fill, float chaos){
  float v = length(x);
  float c = abs(fract(v) - 0.5), th = 0.5 * mix(0.05, 0.95, fill);
  Lay s; s.d = (c - th) * cs; s.h = rdome(s.d, th * cs); s.tone = 0.5 * s.h + 0.5 * hash11(floor(v) * 0.61 + 2.0); s.es = 0.0; return s; }

Lay lFog(vec2 x, float cs, float fill, vec2 z){
  float n = 0.5 + 0.5 * fbm(x * 0.45 + 2.0, z, 5.0), thr = mix(0.85, 0.15, fill);
  Lay s; s.d = (thr - n) * cs * 1.5; s.h = smoothstep(thr - 0.05, thr + 0.35, n);
  s.tone = 0.5 + 0.5 * fbm(x * 0.9 + 31.0, z, 3.0); s.es = cs * 0.3; return s; }

Lay lFluid(vec2 x, float cs, float fill, float chaos, vec2 z){
  vec2 w = vec2(fbm(x * 0.4 + 1.0, z, 3.0), fbm(x * 0.4 + 23.0, z + 2.0, 3.0));
  float n = 0.5 + 0.5 * fbm(x * 0.5 + (0.6 + 2.2 * chaos) * w, z, 5.0);
  float tn = smoothstep(0.28, 0.72, n + (fill - 0.5) * 0.6);
  Lay s; s.d = -1000.0; s.h = tn; s.tone = tn; s.es = 0.0; return s; }

Lay lFacets(vec2 x, float cs, float fill, float chaos){
  vec3 v = rvoro(x, mix(0.2, 1.0, chaos), 0.02);
  Lay s; s.d = -1000.0; s.h = clamp(0.6 * v.y + 0.4 * smoothstep(0.0, 0.1 + 0.3 * fill, v.x), 0.0, 1.0); s.tone = v.y; s.es = 0.0; return s; }

// Ebene beleuchten und auf das Bild legen
vec3 rshade(vec3 col, Lay s, Cam c, vec3 L, vec3 ca, vec3 cb, float op, float relief, float gloss, float glass, float soft, float detail, float cs, float blend){
  float bl = c.bl + soft * soft * 0.12 * c.px * min(uRes.x, uRes.y);
  float e = c.px * 0.75 + bl + s.es;
  float cov = 1.0 - smoothstep(-e, e, s.d);
  // feine Oberflächenstruktur (verschwindet in der Unschärfe)
  float ts = max(cs * 0.07 + 0.003, c.px * 2.5);              // nie feiner als ~2,5 Pixel
  vec2 y = c.q / ts;
  float tex = 0.6 * rvn(y) + 0.4 * rvn(y * 2.3 + 5.0);
  float tf = detail * clamp(1.0 - bl / (ts * 1.5 + 1e-5), 0.0, 1.0);
  float H = s.h + tf * 0.22 * (tex - 0.5);
  float rl = relief / (1.0 + bl / (cs * 0.15 + 1e-5));
  vec2 g = vec2(dFdx(H), dFdy(H)) / c.px * cs * 0.3;
  vec3 n = normalize(vec3(-g * rl * 2.5, 1.0));
  // Glanzlicht aus der glatten Form (ohne Feinstruktur) – sonst glitzert es
  vec2 g0 = vec2(dFdx(s.h), dFdy(s.h)) / c.px * cs * 0.3;
  vec3 n0 = normalize(vec3(-g0 * rl * 2.5, 1.0));
  float dif = clamp(dot(n, L), 0.0, 1.0);
  float lit = mix(1.0, 0.5 + 0.8 * dif, clamp(rl * 1.2, 0.0, 1.0));
  vec3 base = mix(cb, ca, clamp(s.tone, 0.0, 1.0)) * (1.0 - 0.3 * tf * (1.0 - tex));
  vec3 hv = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(clamp(dot(n0, hv), 0.0, 1.0), mix(10.0, 120.0, gloss)) * gloss * 0.9 * clamp(rl * 3.0, 0.0, 1.0) * cov;
  float fres = pow(1.0 - n0.z, 2.0);
  vec3 lc = base * lit + spec + fres * gloss * 0.25;
  float edge = 1.0 - clamp(s.h, 0.0, 1.0);
  float a = cov * op * mix(1.0, 0.15 + 0.85 * edge * edge, glass);
  // weicher Schatten unter der Ebene
  float shd = 1.0 - smoothstep(0.0, cs * 0.6 + bl + 1e-5, s.d);
  col *= 1.0 - relief * 0.16 * op * shd * shd * (1.0 - cov);
  if (blend < 0.5) return mix(col, lc, a);
  if (blend < 1.5) return col + lc * a;
  if (blend < 2.5) return mix(col, col * lc, a);
  return mix(col, 1.0 - (1.0 - col) * (1.0 - lc), a);
}
`;

  /* ---------- Rezept -> Shader ---------- */
  function toCode(rc) {
    const layers = rc.layers.map((L, i) => {
      const n = 'u_e' + (i + 1), T = TYPES[L.type];
      return `  { // Ebene ${i + 1}: ${T.label}
    float cs = 0.02 + 0.9 * ${n}_size * ${n}_size;
    vec2 z = rz(${n}_motion, ${n}_move, ${n}_speed, t);
    vec2 x = rco(c, cs, ${n}_angle, ${T.noSeed ? '0.0' : `u_seed + ${(i + 1) * 13.7}`}, ${n}_chaos * ${T.warp.toFixed(2)}, ${n}_motion, ${n}_move, ${n}_speed, t);
    Lay s = ${T.call(n)};
    col = rshade(col, s, c, L, ${n}_a, ${n}_b, ${n}_opacity, ${n}_relief, ${n}_gloss, ${n}_glass, ${n}_soft, ${n}_detail, cs, ${BLENDS.indexOf(L.blend).toFixed(1)});
  }`;
    }).join('\n');
    return `// Rezept: ${describe(rc)} – aus Bausteinen der App zusammengesetzt (js/ai/recipe.js)
${LIB}
vec3 image(vec2 uv, vec2 p, float t) {
  Cam c = rcam(p, u_tilt, u_roll, u_zoom, u_focus, u_blur);
  vec3 col = rback(uv, p, u_bg1, u_bg2, u_glow, vec2(u_glowx, u_glowy), u_glowsize, u_glowamt, u_bgangle);
  vec3 L = normalize(vec3(cos(radians(u_light)), sin(radians(u_light)), 0.75));
${layers}
  col = mix(col, u_glow, u_haze * smoothstep(0.1, 1.3, log(max(c.w, 1.0))));
  return col;
}
`;
  }

  /* ---------- kleiner Renderer im Hauptfenster (der Shader stammt von der App, nicht vom Modell) ---------- */
  class Renderer {
    constructor() {
      this.cv = document.createElement('canvas');
      const gl = this.gl = this.cv.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
      if (!gl) throw new Error('WebGL2 ist in diesem Browser nicht verfügbar.');
      gl.bindVertexArray(gl.createVertexArray());
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.prog = null; this.locs = {};
    }
    compile(params, code) {
      const gl = this.gl, sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, CG.glsl.vert)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, CG.ai.shader.source(params, code)));
      gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      if (this.prog) gl.deleteProgram(this.prog);
      this.prog = p; this.locs = {}; this.params = params;
      gl.useProgram(p);
      const one = { uSS: 1, uMotion: 1, uBright: 1, uContrast: 1, uSat: 1, uImgOverlay: 1 };
      ['uSS', 'uMotion', 'uBright', 'uContrast', 'uSat', 'uTemp', 'uGrain', 'uVignette', 'uImgOn', 'uImgOverlay'].forEach(n => gl.uniform1f(this.loc(n), one[n] || 0));
      gl.uniform2f(this.loc('uOffset'), 0, 0);
    }
    loc(n) { return n in this.locs ? this.locs[n] : (this.locs[n] = this.gl.getUniformLocation(this.prog, n)); }
    size(w, h) { if (this.cv.width !== w) this.cv.width = w; if (this.cv.height !== h) this.cv.height = h; this.gl.viewport(0, 0, w, h); this.gl.uniform2f(this.loc('uRes'), w, h); }
    set(list) { const gl = this.gl; for (const [n, kind, v] of list) { if (kind === 'vec3') gl.uniform3f(this.loc(n), v[0], v[1], v[2]); else gl.uniform1f(this.loc(n), v); } }
    draw(t) { const gl = this.gl; gl.uniform1f(this.loc('uPhase'), t); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    // Regler-Vorgaben setzen und ein Bild zeichnen
    render(w, h, t = 0.25, values = null) { this.size(w, h); this.set(CG.ai.shader.uniforms(this.params, values || {})); this.draw(t); return this.cv; }
    pixels(w, h) { const px = new Uint8Array(w * h * 4); this.gl.readPixels(0, 0, w, h, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px); return px; }
    destroy() { const e = this.gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); this.cv.width = this.cv.height = 0; }
  }

  /* ---------- Bildmerkmale für den Vergleich ----------
     Kein Pixelvergleich (die Muster sind zufällig), sondern Statistik auf einem 8×8-Raster:
     mittlere Farbe, lokaler Kontrast, Kantenstärke waagrecht/senkrecht in zwei Maßstäben, dazu Helligkeitsverteilung. */
  const G = 8;
  function features(px, w, h, flipY) {
    const lum = new Float32Array(w * h), cells = G * G;
    const f = new Float32Array(cells * 8 + 10 + 1 + 16 + 16), cnt = new Float32Array(cells), l2 = new Float32Array(cells), lm = new Float32Array(cells);
    let sat = 0;
    for (let y = 0; y < h; y++) {
      const sy = flipY ? h - 1 - y : y, gy = Math.min(G - 1, (y * G / h) | 0);
      for (let x = 0; x < w; x++) {
        const i = (sy * w + x) * 4, r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
        const l = 0.299 * r + 0.587 * g + 0.114 * b, c = gy * G + Math.min(G - 1, (x * G / w) | 0);
        lum[y * w + x] = l;
        f[c * 8] += r; f[c * 8 + 1] += g; f[c * 8 + 2] += b; lm[c] += l; l2[c] += l * l; cnt[c]++;
        sat += Math.max(r, g, b) - Math.min(r, g, b);
        f[cells * 8 + Math.min(9, (l * 10) | 0)] += 1;
        // Farbton-Verteilung: warm/kalt und grün/magenta (verhindert Farben, die es in der Referenz nicht gibt)
        f[cells * 8 + 11 + Math.min(7, Math.max(0, (((r - b) * 0.5 + 0.5) * 8) | 0))] += 1;
        f[cells * 8 + 19 + Math.min(7, Math.max(0, (((g - 0.5 * (r + b)) * 0.5 + 0.5) * 8) | 0))] += 1;
      }
    }
    for (let y = 0; y < h; y++) {
      const gy = Math.min(G - 1, (y * G / h) | 0);
      for (let x = 0; x < w; x++) {
        const c = gy * G + Math.min(G - 1, (x * G / w) | 0), l = lum[y * w + x];
        if (x + 1 < w) f[c * 8 + 4] += Math.abs(lum[y * w + x + 1] - l);
        if (y + 1 < h) f[c * 8 + 5] += Math.abs(lum[(y + 1) * w + x] - l);
        if (x + 4 < w) f[c * 8 + 6] += Math.abs(lum[y * w + x + 4] - l);
        if (y + 4 < h) f[c * 8 + 7] += Math.abs(lum[(y + 4) * w + x] - l);
      }
    }
    for (let c = 0; c < cells; c++) {
      const n = Math.max(1, cnt[c]), m = lm[c] / n;
      f[c * 8] /= n; f[c * 8 + 1] /= n; f[c * 8 + 2] /= n;
      f[c * 8 + 3] = Math.sqrt(Math.max(0, l2[c] / n - m * m)) * 2;          // lokaler Kontrast
      f[c * 8 + 4] *= 6 / n; f[c * 8 + 5] *= 6 / n; f[c * 8 + 6] *= 3 / n; f[c * 8 + 7] *= 3 / n;
    }
    for (let k = 0; k < 10; k++) f[cells * 8 + k] *= 2 / (w * h);
    f[cells * 8 + 10] = sat / (w * h);
    for (let k = 11; k < 27; k++) f[cells * 8 + k] *= 2 / (w * h);
    // Formgrößen unabhängig von der Farbe: mittlere Länge heller und dunkler Abschnitte (waagrecht und senkrecht),
    // getrennt für die vier Bildviertel – unterscheidet dünne Stränge mit großen Löchern von dicken mit kleinen
    const runs = (x0, y0, x1, y1, vertical) => {
      let m = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { m += lum[y * w + x]; n++; } m /= Math.max(1, n);
      let sb = 0, nb = 0, sd = 0, nd = 0;
      const A = vertical ? x1 - x0 : y1 - y0, B = vertical ? y1 - y0 : x1 - x0;
      for (let a = 0; a < A; a++) { let len = 0, cur = -1;
        for (let bq = 0; bq <= B; bq++) {
          const v = bq < B ? (lum[vertical ? (y0 + bq) * w + x0 + a : (y0 + a) * w + x0 + bq] > m ? 1 : 0) : -2;
          if (v === cur) len++; else { if (cur === 1) { sb += len; nb++; } else if (cur === 0) { sd += len; nd++; } cur = v; len = 1; } } }
      return [nb ? sb / nb / B : 0, nd ? sd / nd / B : 0];
    };
    const hw = w >> 1, hh = h >> 1, R0 = cells * 8 + 27;
    [[0, 0, hw, hh], [hw, 0, w, hh], [0, hh, hw, h], [hw, hh, w, h]].forEach((q, i) => {
      const a = runs(q[0], q[1], q[2], q[3], false), b = runs(q[0], q[1], q[2], q[3], true);
      f[R0 + i * 4] = a[0]; f[R0 + i * 4 + 1] = a[1]; f[R0 + i * 4 + 2] = b[0]; f[R0 + i * 4 + 3] = b[1];
    });
    return f;
  }
  const WEIGHTS = (() => { const wv = new Float32Array(G * G * 8 + 43);
    for (let c = 0; c < G * G; c++) wv.set([1, 1, 1, 1.5, 1.5, 1.5, 1.2, 1.2], c * 8);
    wv.fill(1.2, G * G * 8, G * G * 8 + 10); wv[G * G * 8 + 10] = 6; wv.fill(4, G * G * 8 + 11, G * G * 8 + 27); wv.fill(14, G * G * 8 + 27); return wv; })();
  const WSUM = WEIGHTS.reduce((a, b) => a + b, 0);
  function distance(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += WEIGHTS[i] * Math.abs(a[i] - b[i]); return s / WSUM; }
  const similarity = d => Math.round(100 * Math.max(0, 1 - d / 0.14));       // grobe Anzeige in Prozent

  // Größe des Vergleichsbilds
  function fitSize(aspect) { const s = 96; return aspect >= 1 ? [Math.round(s * Math.min(aspect, 2.5)), s] : [s, Math.round(s / Math.max(aspect, 0.4))]; }

  // Referenz (Base64-JPEG) auf das Format zuschneiden und Merkmale berechnen
  async function referenceFeatures(base64, aspect) {
    const [w, h] = fitSize(aspect);
    const bmp = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + base64)).blob());
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const k = Math.max(w / bmp.width, h / bmp.height), dw = bmp.width * k, dh = bmp.height * k;
    g.imageSmoothingQuality = 'high'; g.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh); bmp.close();
    const f = features(g.getImageData(0, 0, w, h).data, w, h, false);
    cv.width = cv.height = 0;
    return { f, w, h };
  }

  /* ---------- automatisches Angleichen ----------
     Zufallssuche über alle Zahlen und Farben: kleine Änderungen werden behalten, wenn das Bild der Referenz
     ähnlicher wird. Läuft ohne Modell auf der Grafikkarte (ein Vergleich ≈ 1–2 ms). */
  const NO_FIT = /^(seed|roll)$|_(move|speed|motion)$/;
  const WIDE = /^(zoom|tilt|glowx|glowy|glowsize|glowamt|light|bgangle|haze)$|_(size|fill|opacity)$/;

  /* Farben ausrechnen statt suchen: Das Bild hängt (fast) linear von jeder Farbe ab. Jede Farbe wird einzeln ein Stück
     verschoben und neu gerendert; eine Ausgleichsrechnung auf dem 8×8-Raster bestimmt daraus die Mischung, die der
     Referenz am nächsten kommt (drei Durchgänge, weil überlagerte Ebenen nicht ganz linear sind).
     lambda hält die Farben in der Nähe des Vorschlags des Modells (c0). */
  function solveColors(renderer, params, ref, lambda = 0.05) {
    const cols = params.filter(p => p.type === 'color'), K = cols.length, { w, h } = ref, gl = renderer.gl, N = G * G;
    if (!K) return;
    const grid = () => { renderer.draw(0.25); const f = features(renderer.pixels(w, h), w, h, true); const o = new Float32Array(N * 3); for (let c = 0; c < N; c++) { o[c * 3] = f[c * 8]; o[c * 3 + 1] = f[c * 8 + 1]; o[c * 3 + 2] = f[c * 8 + 2]; } return o; };
    const put = (p, c) => gl.uniform3f(renderer.loc('u_' + p.id), c[0], c[1], c[2]);
    const c0 = cols.map(p => p.c0 || (p.c0 = CG.util.hexToRgb(p.default)));       // Vorschlag des Modells merken
    const cur = cols.map(p => CG.util.hexToRgb(p.default));
    for (let pass = 0; pass < 3; pass++) {
      cols.forEach((p, i) => put(p, cur[i]));
      const base = grid();
      const M = cols.map((p, i) => {
        const d = cur[i].map(v => v < 0.6 ? 0.3 : -0.3), sh = cur[i].map((v, k) => v + d[k]);
        put(p, sh); const g = grid(); put(p, cur[i]);
        for (let c = 0; c < N; c++) for (let k = 0; k < 3; k++) g[c * 3 + k] = (g[c * 3 + k] - base[c * 3 + k]) / d[k];
        return g; });
      for (let ch = 0; ch < 3; ch++) {
        const A = Array.from({ length: K }, () => new Float64Array(K)), b = new Float64Array(K);
        for (let i = 0; i < K; i++) {
          for (let j = i; j < K; j++) { let q = 0; for (let c = 0; c < N; c++) q += M[i][c * 3 + ch] * M[j][c * 3 + ch]; A[i][j] = A[j][i] = q; }
          let q = 0; for (let c = 0; c < N; c++) { let r = ref.f[c * 8 + ch] - base[c * 3 + ch]; for (let j = 0; j < K; j++) r += M[j][c * 3 + ch] * cur[j][ch]; q += M[i][c * 3 + ch] * r; }
          b[i] = q;                                                  // Zielwert bezogen auf die absolute Farbe
        }
        let tr = 0; for (let i = 0; i < K; i++) tr += A[i][i];
        const reg = lambda * tr / K + 1e-6;
        for (let i = 0; i < K; i++) { A[i][i] += reg; b[i] += reg * c0[i][ch]; }
        const x = cur.map(c => c[ch]);                               // projiziertes Gauss-Seidel (Werte bleiben in 0..1)
        for (let it = 0; it < 60; it++) for (let i = 0; i < K; i++) { let q = b[i]; for (let j = 0; j < K; j++) if (j !== i) q -= A[i][j] * x[j]; x[i] = Math.min(1, Math.max(0, q / A[i][i])); }
        x.forEach((v, i) => { cur[i][ch] = cur[i][ch] + 0.8 * (v - cur[i][ch]); });
      }
    }
    const toHex = v => '#' + v.map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');
    cols.forEach((p, i) => { p.default = toHex(cur[i]); put(p, cur[i]); });
  }

  async function fit(renderer, params, ref, { steps = 900, signal, onProgress, seed = 1 } = {}) {
    const out = params.map(p => ({ ...p }));
    // Suchraum: Bildaufbau (Kamera, Licht, Größen) darf sich deutlich bewegen, der Charakter der Ebenen (Fülle, Relief, Weichheit …)
    // bleibt nah am Vorschlag des Modells – die Statistik kann Aufbau und Farben gut beurteilen, den Charakter nicht
    const vars = out.filter(p => p.type === 'range' && !NO_FIT.test(p.id)).map(p => ({ p, rad: WIDE.test(p.id) ? 0.3 : 0.08 }));
    const x0 = vars.map(v => (v.p.default - v.p.min) / (v.p.max - v.p.min));
    const { w, h } = ref, gl = renderer.gl;
    renderer.size(w, h); renderer.set(CG.ai.shader.uniforms(out, {}));
    const apply = x => { for (let i = 0; i < vars.length; i++) { const p = vars[i].p; gl.uniform1f(renderer.loc('u_' + p.id), p.min + x[i] * (p.max - p.min)); } };
    const loss = x => { apply(x); renderer.draw(0.25); return distance(features(renderer.pixels(w, h), w, h, true), ref.f); };
    const lim = (i, v) => Math.min(1, x0[i] + vars[i].rad, Math.max(0, x0[i] - vars[i].rad, v));
    let s = seed * 9301 + 49297;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(6.2831853 * rnd());
    let x = x0.slice();
    const start = loss(x);
    solveColors(renderer, out, ref);
    let best = loss(x);
    for (let it = 0; it < steps; it++) {
      if (signal && signal.aborted) throw signal.reason || new DOMException('Abgebrochen', 'AbortError');
      const sigma = 0.2 * Math.pow(0.03 / 0.2, it / steps);
      const c = x.slice(), n = rnd() < 0.5 ? 1 : 2 + ((rnd() * 2) | 0);
      for (let k = 0; k < n; k++) { const j = (rnd() * vars.length) | 0; c[j] = lim(j, c[j] + gauss() * sigma); }
      const l = loss(c);
      if (l < best) { best = l; x = c; }
      if (it % 150 === 149) { apply(x); solveColors(renderer, out, ref); best = loss(x); }        // Farben zur neuen Struktur nachziehen
      if (it % 60 === 59) { onProgress && onProgress({ done: it + 1, steps, start, best }); await new Promise(r => setTimeout(r, 0)); }
    }
    apply(x); solveColors(renderer, out, ref); best = loss(x);
    vars.forEach((v, i) => { const p = v.p, val = p.min + x[i] * (p.max - p.min); p.default = +(Math.round(val / p.step) * p.step).toFixed(4); });
    out.forEach(p => { delete p.c0; });
    return { params: out, start, best };
  }

  /* Überflüssige Ebenen finden: Jede Ebene wird probeweise ausgeblendet (Deckkraft 0, kein Neu-Kompilieren).
     Passt das Bild ohne sie mindestens so gut zur Referenz, schadet sie nur – ihr Index wird zurückgegeben. */
  function prune(renderer, params, ref) {
    const { w, h } = ref, gl = renderer.gl, n = params.filter(p => /^e\d+_opacity$/.test(p.id)).length;
    if (n < 2) return [];
    renderer.size(w, h); renderer.set(CG.ai.shader.uniforms(params, {}));
    const measure = () => { renderer.draw(0.25); return distance(features(renderer.pixels(w, h), w, h, true), ref.f); };
    const base = measure(), drop = [];
    for (let i = 1; i <= n; i++) {
      const p = params.find(q => q.id === `e${i}_opacity`);
      gl.uniform1f(renderer.loc('u_' + p.id), 0);
      if (measure() <= base && drop.length < n - 1) drop.push(i - 1);
      gl.uniform1f(renderer.loc('u_' + p.id), p.default);
    }
    return drop;
  }

  return { prune, MAX_LAYERS, TYPES, TYPE_IDS, BLENDS, MOTIONS, SCHEMA, LIB, normalize, toParams, withParams, toCode, describe,
    Renderer, features, distance, similarity, fitSize, referenceFeatures, fit, solveColors };
})();
