'use strict';
/* KI: Schemas
   - ANALYSIS: JSON-Schema für die strukturierte Bildbeschreibung (Ollama `format`)
   - validateParams: Parameter-Schema eines Generators prüfen und normalisieren
   - toGroups / toGenValues: Abbildung auf das Regler-System der App */
CG.ai = CG.ai || {};
CG.ai.schema = (() => {
  const TECHNIQUES = ['noise', 'flowfield', 'particles', 'grid', 'tiles', 'voronoi', 'lsystem', 'recursion', 'circles',
    'waves', 'lines', 'curves', 'halftone', 'gradient', 'typography', 'scatter', 'spirals', 'polygons'];

  const str = { type: 'string' }, strs = { type: 'array', items: { type: 'string' } };
  const ANALYSIS = {
    type: 'object',
    properties: {
      title: str,
      summary: str,
      colors: { type: 'array', items: { type: 'object', properties: { hex: str, role: str }, required: ['hex', 'role'] } },
      colorMood: str,
      shapes: strs,
      geometry: str,
      patterns: strs,
      repetition: str,
      symmetry: str,
      composition: str,
      density: { type: 'string', enum: ['niedrig', 'mittel', 'hoch'] },
      rhythm: str,
      depth: str,
      textures: strs,
      lineQuality: str,
      contrast: str,
      motion: str,
      mood: str,
      techniques: { type: 'array', items: { type: 'string', enum: TECHNIQUES } },
    },
    required: ['title', 'summary', 'colors', 'colorMood', 'shapes', 'geometry', 'patterns', 'repetition', 'symmetry',
      'composition', 'density', 'rhythm', 'depth', 'textures', 'lineQuality', 'contrast', 'motion', 'mood', 'techniques'],
  };

  // Antwortformat des Bildvergleichs
  const REVIEW = { type: 'object', properties: { score: { type: 'integer', minimum: 1, maximum: 10 }, matches: strs, problems: strs, improvements: strs },
    required: ['score', 'matches', 'problems', 'improvements'] };

  // Ebenen-Plan
  const LAYER = { type: 'object', properties: { id: str, name: str, what: str, where: str, look: str, motion: str, technique: str },
    required: ['id', 'name', 'what', 'where', 'look', 'motion', 'technique'] };
  const PLAN = { type: 'object', properties: { background: str, layers: { type: 'array', items: LAYER, minItems: 2, maxItems: 5 } },
    required: ['background', 'layers'] };

  function cleanPlan(j, fallbackBg) {
    const o = j && typeof j === 'object' ? j : {};
    const used = new Set();
    const layers = (Array.isArray(o.layers) ? o.layers : []).slice(0, 5).map((L, i) => {
      let id = String((L && L.id) || 'layer' + (i + 1)).replace(/[^A-Za-z0-9]/g, '').replace(/^[0-9]+/, '') || 'layer' + (i + 1);
      id = id[0].toLowerCase() + id.slice(1);
      while (used.has(id)) id += i;
      used.add(id);
      const f = k => String((L && L[k]) || '').slice(0, 600);
      return { id, name: f('name').slice(0, 30) || 'Ebene ' + (i + 1), what: f('what'), where: f('where'), look: f('look'), motion: f('motion'), technique: f('technique') };
    });
    return { background: normHex(o.background) || fallbackBg || '#202020', layers };
  }

  // Antwortformat des Code-Schritts
  const CODE = { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] };

  // Analyse säubern (fehlende Felder ergänzen, Farben normalisieren)
  function cleanAnalysis(a) {
    const o = a && typeof a === 'object' ? a : {};
    const out = {};
    for (const k of ANALYSIS.required) {
      const t = ANALYSIS.properties[k].type;
      out[k] = t === 'array' ? (Array.isArray(o[k]) ? o[k] : []) : (typeof o[k] === 'string' ? o[k] : '');
    }
    out.colors = out.colors.map(c => ({ hex: normHex(c && c.hex), role: String((c && c.role) || '') })).filter(c => c.hex);
    out.techniques = out.techniques.filter(t => TECHNIQUES.includes(t));
    out.title = (out.title || 'Generator').slice(0, 60);
    return out;
  }

  function normHex(v) {
    let s = String(v || '').trim().toLowerCase();
    if (/^[0-9a-f]{3}([0-9a-f]{3})?$/.test(s)) s = '#' + s;
    if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s.slice(1).split('').map(c => c + c).join('');
    return /^#[0-9a-f]{6}$/.test(s) ? s : null;
  }

  const TYPES = ['range', 'color', 'select', 'toggle', 'seed'];
  const ID = /^[A-Za-z_$][\w$]*$/;
  const RESERVED = new Set(['constructor', '__proto__', 'prototype']);

  /* Prüft das Parameter-Schema. Kleine Fehler werden korrigiert (warnings),
     Grundfehler landen in errors und führen zur Reparatur durch das Modell. */
  function validateParams(params) {
    const errors = [], warnings = [], out = [];
    if (!Array.isArray(params)) return { ok: false, errors: ['`params` muss ein Array sein (const params = [ … ]).'], warnings, params: [] };
    if (!params.length) errors.push('`params` ist leer – mindestens 4 Regler definieren.');
    if (params.length > 40) errors.push(`Zu viele Parameter (${params.length}); höchstens 40.`);
    const seen = new Set();
    params.forEach((p, i) => {
      const where = `params[${i}]`;
      if (!p || typeof p !== 'object') { errors.push(`${where} ist kein Objekt.`); return; }
      const id = p.id;
      if (typeof id !== 'string' || !ID.test(id) || RESERVED.has(id)) { errors.push(`${where}.id „${id}“ ist kein gültiger Bezeichner (z. B. "lineWidth").`); return; }
      if (seen.has(id)) { errors.push(`Parameter-id „${id}“ ist doppelt.`); return; }
      seen.add(id);
      let type = String(p.type || '').toLowerCase();
      if (type === 'number' || type === 'slider' || type === 'float' || type === 'int') { warnings.push(`${id}: type „${p.type}“ als "range" gelesen.`); type = 'range'; }
      if (type === 'boolean' || type === 'checkbox' || type === 'bool') { warnings.push(`${id}: type „${p.type}“ als "toggle" gelesen.`); type = 'toggle'; }
      if (!TYPES.includes(type)) { errors.push(`${id}: unbekannter type „${p.type}“ (erlaubt: ${TYPES.join(', ')}).`); return; }
      const q = { id, label: String(p.label || id).slice(0, 40), type, group: p.group ? String(p.group).slice(0, 24) : null };
      if (type === 'range') {
        const min = +p.min, max = +p.max;
        if (!isFinite(min) || !isFinite(max) || min >= max) { errors.push(`${id}: min/max ungültig (min=${p.min}, max=${p.max}).`); return; }
        let step = +p.step;
        if (!isFinite(step) || step <= 0) { step = +((max - min) / 100).toPrecision(2); warnings.push(`${id}: step ergänzt (${step}).`); }
        let def = +(p.default ?? p.value);
        if (!isFinite(def)) { def = min + (max - min) / 2; warnings.push(`${id}: default ergänzt.`); }
        if (def < min || def > max) { warnings.push(`${id}: default ${def} auf [${min}, ${max}] begrenzt.`); def = Math.min(max, Math.max(min, def)); }
        Object.assign(q, { min, max, step, default: def });
      } else if (type === 'seed') {
        let def = Math.round(+(p.default ?? 1));
        if (!isFinite(def)) def = 1;
        Object.assign(q, { min: 0, max: 9999, step: 1, default: Math.min(9999, Math.max(0, def)) });
      } else if (type === 'color') {
        const def = normHex(p.default ?? p.value);
        if (!def) { errors.push(`${id}: color braucht default im Format "#rrggbb" (ist „${p.default}“).`); return; }
        q.default = def;
      } else if (type === 'select') {
        const opts = Array.isArray(p.options) ? p.options.map(o => (o && typeof o === 'object') ? String(o.value ?? o.label) : String(o)).filter(Boolean) : [];
        if (opts.length < 2) { errors.push(`${id}: select braucht options mit mindestens 2 Einträgen.`); return; }
        q.options = [...new Set(opts)].slice(0, 12);
        q.default = q.options.includes(String(p.default)) ? String(p.default) : q.options[0];
        if (String(p.default) !== q.default) warnings.push(`${id}: default auf „${q.default}“ gesetzt.`);
      } else if (type === 'toggle') {
        q.default = p.default === true || p.default === 'true' || p.default === 1;
      }
      out.push(q);
    });
    if (!out.some(p => p.type === 'color')) warnings.push('Keine Farb-Parameter – Farben sind nicht einstellbar.');
    return { ok: !errors.length, errors, warnings, params: out };
  }

  /* ---------- Abbildung auf das Regler-System ----------
     Schlüssel im App-Zustand: "g_<id>"; Farben -> Paletten-Gruppe; select ≤ 3 kurze Optionen -> Segment */
  const keyOf = id => 'g_' + id;

  function toControl(p) {
    const base = { key: keyOf(p.id), label: p.label, genId: p.id, genType: p.type };
    switch (p.type) {
      case 'range': {
        const c = { ...base, min: p.min, max: p.max, step: p.step, def: p.default };
        if (p.step < 0.01) { const d = Math.min(4, Math.ceil(-Math.log10(p.step))); c.format = v => (+v).toFixed(d).replace('.', ','); }
        return c;
      }
      case 'seed': return { ...base, label: p.label || 'Seed', min: 0, max: 9999, step: 1, def: p.default, action: 'random' };
      case 'toggle': return { ...base, type: 'segment', def: p.default ? 1 : 0, options: [{ v: 0, label: 'Aus' }, { v: 1, label: 'An' }] };
      case 'select': {
        const short = p.options.length <= 3 && p.options.every(o => o.length <= 9);
        return { ...base, type: short ? 'segment' : 'select', def: p.default, options: p.options.map(o => ({ v: o, label: o })) };
      }
      case 'color': return { ...base, type: 'color', def: p.default };
    }
    return null;
  }

  function toGroups(fnId, params) {
    const groups = [], byName = new Map();
    const colors = params.filter(p => p.type === 'color');
    for (const p of params) {
      if (p.type === 'color') continue;
      const name = p.type === 'seed' ? (p.group || 'Form') : (p.group || 'Form');
      if (!byName.has(name)) { const g = { id: fnId + '-' + groups.length, title: name, params: [] }; byName.set(name, g); groups.push(g); }
      byName.get(name).params.push(toControl(p));
    }
    if (colors.length) {
      const def = {}; colors.forEach(p => { def[keyOf(p.id)] = p.default; });
      groups.push({ id: fnId + '-color', title: 'Farbe', palette: true, palettes: [{ name: 'Original', c: def }],
        params: colors.map(toControl) });
    }
    return groups;
  }

  // App-Zustand -> Werte für den Generator ({ id: Wert })
  function toGenValues(params, state) {
    const o = {};
    for (const p of params) {
      let v = state[keyOf(p.id)];
      if (v === undefined) v = p.default;
      if (p.type === 'toggle') v = !!+v;
      else if (p.type === 'range') v = +v;
      else if (p.type === 'seed') v = Math.round(+v) || 0;
      else v = String(v);
      o[p.id] = v;
    }
    return o;
  }
  // Generator-Werte -> App-Zustand (für Presets)
  function fromGenValues(params, values) {
    const o = {};
    for (const p of params) if (values && p.id in values) o[keyOf(p.id)] = p.type === 'toggle' ? (values[p.id] ? 1 : 0) : values[p.id];
    return o;
  }

  return { ANALYSIS, CODE, REVIEW, PLAN, cleanPlan, TECHNIQUES, cleanAnalysis, normHex, validateParams, toGroups, toGenValues, fromGenValues, keyOf };
})();
