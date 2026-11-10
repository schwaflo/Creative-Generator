'use strict';
/* KI: feste, versionierte Prompt-Vorlagen.
   Das Modell erfindet die Vorlage nicht – es füllt nur den Generator-Code aus.
   Bei Änderungen an Vertrag/Beispiel: VERSION erhöhen (wird mit jedem Generator gespeichert). */
CG.ai = CG.ai || {};
CG.ai.prompt = (() => {
  const VERSION = 'generator-v2';

  /* ---------- Bildanalyse ---------- */
  const ANALYSIS_SYSTEM = 'You are an art director who describes images precisely so that a programmer can recreate their visual style as generative art. Answer in German, but keep the JSON keys in English.';
  const ANALYSIS_USER = `Analysiere dieses Referenzbild für einen generativen Design-Generator.
Beschreibe nur, was wirklich zu sehen ist:
- colors: die 3–6 dominanten Farben als Hex (#rrggbb) mit Rolle (Hintergrund, Hauptfarbe, Akzent, Linie …)
- Formen, Geometrie, Muster, Wiederholungen, Symmetrie
- Komposition, Dichte, Rhythmus, Tiefe/Ebenen
- Texturen, Linienqualität, Kontraste
- motion: wie sich das Motiv als nahtlose Loop-Animation sinnvoll bewegen könnte
- techniques: welche generativen Techniken passen
- title: kurzer, professioneller Name für den Generator (2–3 Wörter)`;

  function analysisMessages(imageBase64) {
    return [
      { role: 'system', content: ANALYSIS_SYSTEM },
      { role: 'user', content: ANALYSIS_USER, images: [imageBase64] },
    ];
  }

  /* ---------- Generator-Vertrag ---------- */
  const CONTRACT = `Write ONE plain JavaScript file (no import/export, no modules) that defines exactly:

  const params = [ ... ];                 // parameter schema, 8–16 entries
  function setup(ctx, p, rng) { ... }     // optional: precompute data; runs when size or parameters change
  function draw(ctx, p, t, rng) { ... }   // paints ONE complete frame

PARAMETER ENTRIES (labels in German):
  { id: "lineWidth", label: "Linienstärke", type: "range", min: 0.5, max: 8, step: 0.1, default: 2, group: "Form" }
  type "range":  numeric min, max, step, default (min < max, default inside)
  type "color":  default "#rrggbb"   (one entry per color, e.g. background, main, accent)
  type "select": options: ["Kreis", "Quadrat"], default: "Kreis"
  type "toggle": default: true or false
  type "seed":   default: integer — exactly one, with id "seed"
  group: "Form", "Struktur" or "Bewegung" (colors are grouped automatically)

RULES
1. ctx is a CanvasRenderingContext2D. Size: const W = ctx.canvas.width, H = ctx.canvas.height, S = Math.min(W, H).
   Express every size and position relative to W, H or S – never fixed pixels. The same frame is rendered at 400 px and at 4000 px.
2. draw() must first fill the whole background (ctx.fillRect(0, 0, W, H)), then paint everything.
3. t runs from 0 to 1 and the animation LOOPS SEAMLESSLY: t = 0 and t = 1 must look identical.
   Animate only with periodic functions of the angle a = 2 * Math.PI * t, e.g. Math.sin(a * k + phase) with integer k.
   Never keep or accumulate state between frames: a frame depends only on (p, t) and data from setup().
4. p.<id> holds the current values: numbers, "#rrggbb" strings, select strings, toggle booleans.
5. Randomness only via rng() (0..1, seeded by p.seed). Math.random is the same seeded generator.
   draw() receives a freshly seeded rng each frame, so random choices stay stable over time.
6. Forbidden: document, window, DOM, fetch, XMLHttpRequest, import, eval, setTimeout, setInterval, requestAnimationFrame, images, external libraries.
7. Performance: at most about 20000 shapes per frame, no unbounded or while(true) loops.
8. Reply with a JSON object of the form {"code": "<the complete JavaScript file>"} and nothing else.`;

  const EXAMPLE = `const params = [
  { id: "rings", label: "Ringe", type: "range", min: 2, max: 14, step: 1, default: 6, group: "Form" },
  { id: "count", label: "Punkte", type: "range", min: 6, max: 90, step: 1, default: 36, group: "Form" },
  { id: "dot", label: "Punktgröße", type: "range", min: 0.002, max: 0.03, step: 0.001, default: 0.008, group: "Form" },
  { id: "shape", label: "Form", type: "select", options: ["Kreis", "Quadrat"], default: "Kreis", group: "Form" },
  { id: "lines", label: "Linien", type: "toggle", default: true, group: "Struktur" },
  { id: "wave", label: "Welle", type: "range", min: 0, max: 1, step: 0.01, default: 0.35, group: "Bewegung" },
  { id: "spin", label: "Drehung", type: "range", min: 0, max: 3, step: 1, default: 1, group: "Bewegung" },
  { id: "bg", label: "Hintergrund", type: "color", default: "#101018" },
  { id: "ink", label: "Punkte", type: "color", default: "#f2c14e" },
  { id: "accent", label: "Akzent", type: "color", default: "#e8505b" },
  { id: "seed", label: "Seed", type: "seed", default: 7 }
];

let rings = [];
function setup(ctx, p, rng) {
  rings = [];
  for (let i = 0; i < p.rings; i++) rings.push({ phase: rng() * Math.PI * 2, dir: rng() < 0.5 ? -1 : 1 });
}

function draw(ctx, p, t, rng) {
  const W = ctx.canvas.width, H = ctx.canvas.height, S = Math.min(W, H);
  const a = 2 * Math.PI * t;
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  rings.forEach((ring, i) => {
    const r0 = S * 0.45 * (i + 1) / rings.length;
    const pts = [];
    for (let k = 0; k < p.count; k++) {
      const ang = (k / p.count) * Math.PI * 2 + a * p.spin * ring.dir;
      const r = r0 * (1 + p.wave * 0.12 * Math.sin(ang * 3 + ring.phase + a));
      pts.push([Math.cos(ang) * r, Math.sin(ang) * r]);
    }
    if (p.lines) {
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = S * 0.0015;
      ctx.beginPath();
      pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.fillStyle = p.ink;
    const d = S * p.dot;
    for (const [x, y] of pts) {
      if (p.shape === "Kreis") { ctx.beginPath(); ctx.arc(x, y, d, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(x - d, y - d, d * 2, d * 2);
    }
  });
  ctx.restore();
}`;

  const SYSTEM = 'You are an expert creative coder. You write small, correct, fast HTML canvas generative-art programs that follow a given contract exactly. You answer only with a JSON object {"code": "..."} that contains the complete JavaScript file.';

  /* Analyse -> lesbarer Steckbrief */
  function describe(a) {
    const L = [], line = (k, v) => { if (v && (!Array.isArray(v) || v.length)) L.push(`- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`); };
    line('Titel', a.title);
    line('Zusammenfassung', a.summary);
    if (a.colors && a.colors.length) L.push('- Farben: ' + a.colors.map(c => `${c.hex} (${c.role})`).join(', '));
    line('Farbstimmung', a.colorMood);
    line('Formen', a.shapes); line('Geometrie', a.geometry); line('Muster', a.patterns);
    line('Wiederholung', a.repetition); line('Symmetrie', a.symmetry); line('Komposition', a.composition);
    line('Dichte', a.density); line('Rhythmus', a.rhythm); line('Tiefe/Ebenen', a.depth);
    line('Texturen', a.textures); line('Linienqualität', a.lineQuality); line('Kontrast', a.contrast);
    line('Bewegung', a.motion); line('Stimmung', a.mood); line('Passende Techniken', a.techniques);
    return L.join('\n');
  }

  /* Haupt-Prompt (wird im UI angezeigt und ist editierbar) */
  function build({ analysis, wishes, format }) {
    const a = analysis || {};
    const colors = (a.colors || []).map(c => c.hex).filter(Boolean);
    const aspect = format ? `${format.w} × ${format.h} px (Seitenverhältnis ${(format.w / format.h).toFixed(3)})` : 'beliebig';
    return `# TASK
Create a generative-art generator that recreates the visual style of the reference image described below.
Capture its colors, shapes, structure, texture and mood – not a literal copy, but a parametric system with many meaningful controls.

# REFERENCE IMAGE (analysis)
${describe(a) || '- (keine Analyse)'}

# REQUIREMENTS
- Target format: ${aspect}. The composition must also adapt to any other width/height.
- Use these colors as defaults for the color parameters: ${colors.length ? colors.join(', ') : 'choose a fitting palette'}.
- Provide 8–16 parameters with real visual impact (density, size, shape variation, structure, motion amount, colors, seed).
- Animation: a calm, seamless loop that fits the image (motion hint: ${a.motion || 'subtle drift'}).
${wishes && wishes.trim() ? `- Additional wishes of the user (high priority):\n${wishes.trim().split('\n').map(s => '  ' + s).join('\n')}\n` : ''}
# CONTRACT (must be followed exactly)
${CONTRACT}

# WORKING EXAMPLE (different style – shows the format only)
\`\`\`js
${EXAMPLE}
\`\`\`

Now write the generator for the reference image. Reply with the JSON object {"code": "..."} only.`;
  }

  function messages(promptText) {
    return [{ role: 'system', content: SYSTEM }, { role: 'user', content: promptText }];
  }

  /* Reparatur: bisheriger Verlauf + Fehlerliste */
  function repair(history, code, errors) {
    return [...history,
      { role: 'assistant', content: JSON.stringify({ code }) },
      { role: 'user', content: `The code above does not work yet. Problems found by the automatic test:
${errors.map(e => '- ' + e).join('\n')}

Fix ALL problems. Keep the contract (const params, setup, draw; seamless loop; sizes relative to S). Keep working parts unchanged.
Reply with the JSON object {"code": "<complete corrected file>"} and nothing else.` }];
  }

  return { VERSION, analysisMessages, build, messages, repair, describe, CONTRACT, EXAMPLE };
})();
