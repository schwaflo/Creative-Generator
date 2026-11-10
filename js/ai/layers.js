'use strict';
/* KI: Ebenen zu einem Generator zusammensetzen.
   Jede Ebene ist eine eigene, vom Modell geschriebene Datei (params, setup, draw) und läuft in einem
   eigenen Gültigkeitsbereich. Die App ergänzt nur das Gerüst: Hintergrund, globale Regler (Hintergrund,
   Tempo, Seed), Präfixe der Regler und die Zeichenreihenfolge. */
CG.ai = CG.ai || {};
CG.ai.layers = (() => {
  const q = s => JSON.stringify(String(s));

  /* layers: [{ id, name, code }] -> { code, ranges: [{ id, start, end }] } (Zeilen der Ebenen im Ergebnis) */
  function assemble(plan, layers) {
    const out = ['// Ebenen-Generator (Creative Generator) – jede Ebene wurde einzeln von der KI geschrieben', ''];
    const ranges = [];
    layers.forEach((L, i) => {
      out.push(`// ===== Ebene ${i + 1}: ${String(L.name).replace(/\n/g, ' ')} =====`);
      // äußere Funktion verdeckt params/setup/draw des Gesamtgenerators, innere enthält den Code der Ebene
      out.push(`const __L${i} = ((params, setup, draw) => (() => {`);
      const start = out.length + 1;
      const lines = String(L.code).replace(/\s+$/, '').split('\n');
      out.push(...lines);
      ranges.push({ id: L.id, name: L.name, start, end: start + lines.length - 1 });
      out.push(`;return { params: (typeof params !== "undefined" && Array.isArray(params)) ? params : [], setup: (typeof setup === "function") ? setup : null, draw: (typeof draw === "function") ? draw : null };`);
      out.push('})())();', '');
    });
    out.push(`const __LAYERS = [${layers.map((L, i) => `{ key: ${q(L.id)}, name: ${q(L.name)}, m: __L${i} }`).join(', ')}];`);
    out.push(`const __GLOBAL = ["seed", "bg", "speed"];
const params = [
  { id: "bg", label: "Hintergrund", type: "color", default: ${q(plan.background || '#202020')} },
  { id: "speed", label: "Tempo", type: "range", min: 1, max: 3, step: 1, default: 1, group: "Bewegung" },
  { id: "seed", label: "Seed", type: "seed", default: 7, group: "Bewegung" },
  ...__LAYERS.flatMap(L => L.m.params.filter(x => x && typeof x.id === "string" && !__GLOBAL.includes(x.id)).map(x => Object.assign({}, x, {
    id: L.key + "_" + x.id,
    label: x.type === "color" ? (L.name + " " + (x.label || x.id)).slice(0, 40) : (x.label || x.id),
    group: L.name
  })))
];
function __sub(p, key) {
  const o = { bg: p.bg, speed: p.speed, seed: p.seed }, pre = key + "_";
  for (const k in p) if (k.startsWith(pre)) o[k.slice(pre.length)] = p[k];
  return o;
}
function setup(ctx, p, rng) {
  for (const L of __LAYERS) if (L.m.setup) { ctx.save(); L.m.setup(ctx, __sub(p, L.key), rng); ctx.restore(); }
}
function draw(ctx, p, t, rng) {
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const L of __LAYERS) {
    if (!L.m.draw) continue;
    ctx.save();
    L.m.draw(ctx, __sub(p, L.key), t, rng);
    ctx.restore();
  }
}`);
    return { code: out.join('\n') + '\n', ranges };
  }

  /* Fehlermeldungen der Prüfung auf Zeilen der Ebene umrechnen (nur Meldungen, die diese Ebene betreffen, bleiben genau) */
  function localizeErrors(errors, range) {
    return errors.map(e => String(e).replace(/\(Zeile (\d+)\)/g, (m, n) => {
      n = +n;
      return n >= range.start && n <= range.end ? `(Zeile ${n - range.start + 1} deiner Ebene)` : '(in einer anderen Ebene oder im Gerüst)';
    }));
  }

  return { assemble, localizeErrors };
})();
