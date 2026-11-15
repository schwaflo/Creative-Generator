'use strict';
/* KI: generierten Generator automatisch prüfen.
   1. Syntax (nur parsen – nichts wird in der App ausgeführt)
   2. verbotene APIs / fehlende Funktionen
   3. Laden in der Sandbox + Parameter-Schema prüfen
   4. Probe-Render bei mehreren t und Reglerständen: Laufzeitfehler, Timeout, leeres Bild, Loop-Naht
   Ergebnis: { ok, errors[], warnings[], params } – errors gehen als Reparaturauftrag an das Modell. */
CG.ai = CG.ai || {};
CG.ai.validate = (() => {
  const BANNED = [
    [/\bdocument\s*\./, 'document (kein DOM-Zugriff erlaubt)'],
    [/\bwindow\s*\./, 'window (kein DOM-Zugriff erlaubt)'],
    [/\bfetch\s*\(/, 'fetch (kein Netzwerk erlaubt)'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest (kein Netzwerk erlaubt)'],
    [/^\s*import\s|\bimport\s*\(/m, 'import (keine Module/externen Bibliotheken)'],
    [/^\s*export\s/m, 'export (normale Skriptdatei ohne export)'],
    [/\beval\s*\(/, 'eval'],
    [/\bset(?:Timeout|Interval)\s*\(/, 'setTimeout/setInterval (draw zeichnet genau ein Bild)'],
    [/\brequestAnimationFrame\b/, 'requestAnimationFrame (die App ruft draw selbst auf)'],
    [/\bnew\s+Image\s*\(/, 'Bilder laden'],
    [/\bwhile\s*\(\s*(?:true|1)\s*\)/, 'while(true)-Schleife'],
  ];

  const lineHint = e => e.line ? ` (Zeile ${e.line})` : '';

  function staticCheck(code) {
    const errors = [];
    if (!code || !code.trim()) return ['Die Antwort enthält keinen Code-Block.'];
    try { new Function(code); }                                  // nur parsen
    catch (e) { return [`Syntaxfehler: ${e.message}. Gib eine vollständige, syntaktisch korrekte Datei zurück.`]; }
    for (const [re, name] of BANNED) if (re.test(code)) errors.push(`Verboten: ${name}.`);
    if (!/\bfunction\s+draw\s*\(|\b(?:const|let|var)\s+draw\s*=/.test(code)) errors.push('Es fehlt `function draw(ctx, p, t, rng)`.');
    if (!/\b(?:const|let|var)\s+params\s*=/.test(code)) errors.push('Es fehlt `const params = [ … ]`.');
    return errors;
  }

  const defaults = params => { const o = {}; params.forEach(p => { o[p.id] = p.default; }); return o; };
  const seedOf = v => Math.round(+(v.seed ?? 1)) || 1;

  // Zufällige bzw. extreme Reglerstände (um Abstürze an den Rändern zu finden)
  function variants(params) {
    const lo = {}, hi = {}, rnd = {};
    let s = 12345;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (const p of params) {
      if (p.type === 'range') {
        lo[p.id] = p.min; hi[p.id] = p.max;
        const v = p.min + r() * (p.max - p.min);
        rnd[p.id] = p.step >= 1 ? Math.round(v) : v;
      } else if (p.type === 'select') { lo[p.id] = p.options[0]; hi[p.id] = p.options[p.options.length - 1]; rnd[p.id] = p.options[(r() * p.options.length) | 0]; }
      else if (p.type === 'toggle') { lo[p.id] = false; hi[p.id] = true; rnd[p.id] = r() < 0.5; }
      else if (p.type === 'seed') { lo[p.id] = 0; hi[p.id] = 9999; rnd[p.id] = (r() * 9999) | 0; }
      else { lo[p.id] = hi[p.id] = rnd[p.id] = p.default; }
    }
    return [['Minimalwerte', lo], ['Maximalwerte', hi], ['Zufallswerte', rnd]];
  }

  async function run(code, { sandbox, aspect = 16 / 9, renderMs = 4000, onStep } = {}) {
    const step = s => onStep && onStep(s);
    const warnings = [];
    step('Syntax');
    let errors = staticCheck(code);
    if (errors.length) return { ok: false, errors, warnings, params: [] };

    step('Laden');
    let info;
    try { info = await sandbox.load(code); }
    catch (e) { return { ok: false, errors: [e.kind === 'timeout' ? 'Der Code hängt bereits beim Laden (Endlosschleife auf oberster Ebene?).' : `Fehler beim Laden${lineHint(e)}: ${e.message}`], warnings, params: [] }; }
    if (!info.hasDraw) return { ok: false, errors: ['`draw` ist keine Funktion.'], warnings, params: [] };

    step('Parameter');
    const v = CG.ai.schema.validateParams(info.params);
    warnings.push(...v.warnings);
    if (!v.ok) return { ok: false, errors: v.errors, warnings, params: [] };
    const params = v.params;
    if (params.length < 4) warnings.push('Wenige Regler (' + params.length + ').');

    step('Probe-Render');
    const w = 320, h = Math.max(48, Math.round(320 / aspect));
    const base = defaults(params);
    const grids = {};
    let visible = false, slow = 0;
    for (const t of [0, 0.37, 0.71, 0.999]) {
      try {
        const r = await sandbox.render({ values: base, t, w, h, seed: seedOf(base), stats: true, timeout: renderMs });
        r.bitmap.close();
        slow = Math.max(slow, r.ms);
        grids[t] = r.stats.grid;
        if (r.stats.nonUniform > 0.003) visible = true;
      } catch (e) {
        errors.push(e.kind === 'timeout'
          ? `draw() bei t=${t} hängt oder ist zu langsam (> ${renderMs} ms). Keine Endlosschleifen, weniger Formen.`
          : `Laufzeitfehler in ${e.stage === 'render' ? 'setup()/draw()' : e.stage}${lineHint(e)} bei t=${t}: ${e.message}`);
        break;
      }
    }
    if (!errors.length && !visible) errors.push('Das Bild ist leer bzw. einfarbig – draw() zeichnet nichts Sichtbares (Farben, Größen relativ zu S, Koordinaten im Bild?).');
    if (!errors.length && slow > renderMs * 0.4) warnings.push(`Langsam: ${Math.round(slow)} ms pro Bild bei ${w} px.`);
    if (!errors.length && grids[0] && grids[0.999]) {
      const d = grids[0].reduce((s, x, i) => s + Math.abs(x - grids[0.999][i]), 0) / grids[0].length;
      if (d > 0.06) warnings.push('Loop nicht nahtlos: t=0 und t=1 unterscheiden sich sichtbar.');
      const m = grids[0].reduce((s, x, i) => s + Math.abs(x - grids[0.37][i]), 0) / grids[0].length;
      if (m < 0.0005) warnings.push('Keine sichtbare Animation über t.');
    }
    if (errors.length) return { ok: false, errors, warnings, params };

    step('Regler-Test');
    for (const [name, vals] of variants(params)) {
      try {
        const r = await sandbox.render({ values: vals, t: 0.5, w, h, seed: seedOf(vals), timeout: renderMs });
        r.bitmap.close();
      } catch (e) {
        errors.push(e.kind === 'timeout'
          ? `Mit ${name} der Regler hängt draw() (> ${renderMs} ms). Begrenze Schleifen abhängig von den Reglern.`
          : `Absturz mit ${name} der Regler${lineHint(e)}: ${e.message}. Alle Reglerwerte zwischen min und max müssen funktionieren.`);
        break;
      }
    }
    return { ok: !errors.length, errors, warnings, params };
  }

  // Wert, der sich deutlich vom Standard unterscheidet
  function altValue(p) {
    if (p.type === 'range') return (p.default - p.min) < (p.max - p.min) / 2 ? p.max : p.min;
    if (p.type === 'toggle') return !p.default;
    if (p.type === 'select') return p.options.find(o => o !== p.default);
    if (p.type === 'color') {
      const c = CG.util.hexToRgb(p.default);
      const cand = [['#ff0000', [1, 0, 0]], ['#00ff00', [0, 1, 0]], ['#0000ff', [0, 0, 1]]];
      const dist = v => v.reduce((s, x, i) => s + Math.abs(x - c[i]), 0);
      return cand.sort((a, b) => dist(b[1]) - dist(a[1]))[0][0];
    }
    return undefined;
  }
  // Regler ohne sichtbare Wirkung finden (Farbvergleich auf einem 16×16-Raster)
  async function deadParams(P, base, render) {
    const ref = (await render(base, 0.37, true)).stats.rgb;
    const dead = [];
    for (const p of P) {
      if (p.type === 'seed') continue;
      const alt = altValue(p);
      if (alt === undefined || alt === p.default) continue;
      const r = await render({ ...base, [p.id]: alt }, 0.37, true);
      let sum = 0, mx = 0;
      r.stats.rgb.forEach((x, i) => { const a = Math.abs(x - ref[i]); sum += a; if (a > mx) mx = a; });
      if (sum / ref.length < 0.004 && mx < 0.03) dead.push(p);       // auch kleine Details zählen
    }
    return dead;
  }

  /* ---------- Shader-Generatoren ----------
     Regler-Schema prüfen, Shader statisch prüfen, im Worker kompilieren (Fehlerzeilen bezogen auf den Shader des Modells),
     Probe-Render bei mehreren t und Extremwerten: leeres Bild, Loop-Naht, Tempo. */
  async function runShader(params, code, { sandbox, aspect = 16 / 9, renderMs = 4000, onStep } = {}) {
    const step = s => onStep && onStep(s);
    const SH = CG.ai.shader;
    const warnings = [];
    step('Regler');
    const v = CG.ai.schema.validateParams(params);
    warnings.push(...v.warnings);
    if (!v.ok) return { ok: false, errors: v.errors, warnings, params: [] };
    const P = v.params;
    if (P.length < 3) warnings.push('Wenige Regler (' + P.length + ').');
    step('Shader');
    const se = SH.staticCheck(code);
    if (se.length) return { ok: false, errors: se, warnings, params: P };
    const frag = SH.source(P, code);
    const w = 320, h = Math.max(48, Math.round(320 / aspect));
    const base = {}; P.forEach(p => { base[p.id] = p.default; });
    const render = async (values, t, stats) => {
      const r = await sandbox.shader({ frag, uniforms: SH.uniforms(P, values), t, w, h, stats, timeout: renderMs });
      r.bitmap.close();
      return r;
    };
    step('Kompilieren');
    const errors = [];
    const grids = {};
    let visible = false, slow = 0;
    for (const t of [0, 0.37, 0.71, 0.999]) {
      try {
        const r = await render(base, t, true);
        slow = Math.max(slow, r.ms);
        grids[t] = r.stats.grid;
        if (r.stats.nonUniform > 0.003) visible = true;
      } catch (e) {
        if (e.errName === 'GLSLError') errors.push('GLSL-Fehler – ' + SH.localizeLog(e.message, frag).join(' | '));
        else errors.push(e.kind === 'timeout' ? `Der Shader ist viel zu langsam (> ${renderMs} ms für ${w} px). Weniger Schleifendurchläufe/Oktaven.` : 'Fehler beim Rendern: ' + e.message);
        break;
      }
    }
    if (!errors.length && !visible) errors.push('Das Bild ist einfarbig – image() liefert überall dieselbe Farbe (Koordinaten p/uv, Größen, Farben prüfen).');
    if (!errors.length && slow > 120) errors.push(`Der Shader braucht ${Math.round(slow)} ms für ein kleines Probebild – in 4K wäre das viel zu langsam. Weniger Schleifen/Oktaven.`);
    else if (!errors.length && slow > 40) warnings.push(`Etwas langsam (${Math.round(slow)} ms bei ${w} px).`);
    if (!errors.length) {
      const d = grids[0].reduce((s, x, i) => s + Math.abs(x - grids[0.999][i]), 0) / grids[0].length;
      if (d > 0.06) warnings.push('Loop nicht nahtlos: t=0 und t=1 unterscheiden sich sichtbar.');
      const m = grids[0].reduce((s, x, i) => s + Math.abs(x - grids[0.37][i]), 0) / grids[0].length;
      if (m < 0.0005) warnings.push('Keine sichtbare Animation über t.');
    }
    if (errors.length) return { ok: false, errors, warnings, params: P };
    step('Regler-Test');
    for (const [name, vals] of variants(P)) {
      try {
        const r = await render(vals, 0.5, false);
        if (r.ms > 250) { errors.push(`Mit ${name} der Regler braucht der Shader ${Math.round(r.ms)} ms – Obergrenzen der Regler oder Schleifen verkleinern.`); break; }
      } catch (e) { errors.push(`Mit ${name} der Regler: ${e.message}`); break; }
    }
    if (errors.length) return { ok: false, errors, warnings, params: P };
    step('Regler-Wirkung');
    try {
      const dead = await deadParams(P, base, render);
      const deadColors = dead.filter(p => p.type === 'color'), deadOther = dead.filter(p => p.type !== 'color');
      const nOther = P.filter(p => p.type !== 'color' && p.type !== 'seed').length;
      deadColors.forEach(p => errors.push(`Die Farbe „${p.label}“ (u_${p.id}) hat keine sichtbare Wirkung – das Bild muss diese Farbe benutzen (z. B. col = mix(col, u_${p.id}, maske)), statt feste Farben oder nur Schwarz/Weiß.`));
      const msg = deadOther.map(p => `„${p.label}“ (u_${p.id})`).join(', ');
      if (deadOther.length && deadOther.length * 3 > nOther) errors.push(`Diese Regler verändern das Bild nicht sichtbar: ${msg}. Jeder Regler muss eine deutliche Wirkung haben.`);
      else if (deadOther.length) warnings.push(`Ohne sichtbare Wirkung: ${msg}.`);
    } catch (e) { errors.push('Fehler beim Regler-Test: ' + e.message); }
    // soft: nur die Regler-Wirkung fehlt – der Shader läuft; die Pipeline darf ihn nach einem Reparaturversuch trotzdem nehmen
    return { ok: !errors.length, errors, warnings, params: P, soft: errors.length > 0 };
  }

  return { run, runShader, staticCheck, deadParams };
})();
