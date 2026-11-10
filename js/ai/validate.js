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

  return { run, staticCheck };
})();
