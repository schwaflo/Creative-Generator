'use strict';
/* KI: feste, versionierte Prompt-Vorlagen.
   Das Modell erfindet die Vorlage nicht – es füllt nur den Generator-Code aus.
   Bei Änderungen an Vertrag/Beispiel: VERSION erhöhen (wird mit jedem Generator gespeichert). */
CG.ai = CG.ai || {};
CG.ai.prompt = (() => {
  const VERSION = 'generator-v3';

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
   For seed variation, offset noise coordinates with rng() values chosen in setup().
6. Forbidden: document, window, DOM, fetch, XMLHttpRequest, import, eval, setTimeout, setInterval, requestAnimationFrame, images, external libraries.
7. Performance: at most about 20000 shapes per frame, no unbounded or while(true) loops.
8. Reply with a JSON object of the form {"code": "<the complete JavaScript file>"} and nothing else.

HELPERS (already defined globally – use them, do not redefine them)
  noise(x, y, z)                 smooth Perlin noise, about -1..1 (change ~1 unit = one bump)
  fbm(x, y, z, octaves)          layered noise for organic detail
  loopNoise(x, y, t, radius, offset)  noise that loops seamlessly over t (same value at t=0 and t=1)
  smoothPath(ctx, points, closed)     smooth curve through [[x,y], …]; call ctx.beginPath() before and stroke()/fill() after
  mix(hexA, hexB, k), rgba(hex, alpha), shade(hex, k from -1 to 1)   -> CSS color strings
  lerp(a, b, k), clamp(v, a, b), smoothstep(a, b, x), TAU

QUALITY (the frame is compared visually with the reference image – this decides success)
- Match the reference: same main subject, position, size, orientation, proportions and color balance.
- Organic lines are never jagged polylines: use smoothPath() with 8–40 points per curve.
- Fine detail = many thin, semi-transparent strokes (hundreds to thousands) with varied length, width and alpha;
  let lines fade or taper toward their ends (ctx.lineCap = "round").
- 3D volume = gradients: createRadialGradient offset toward the light (highlight -> main color -> shadow),
  plus a soft rim or cast shadow. Never leave large shapes as one flat color if the reference looks 3D.
- Organic variation comes from noise()/fbm()/loopNoise(), not from regular repetition (unless the reference is regular).
- Depth: draw back to front; far elements smaller, thinner and mixed toward the background color.
- Motion: gentle and continuous via loopNoise(…, t, …) or Math.sin(a * k + phase).`;

  const EXAMPLE = `const params = [
  { id: "blades", label: "Halme", type: "range", min: 20, max: 600, step: 1, default: 260, group: "Form" },
  { id: "height", label: "Höhe", type: "range", min: 0.1, max: 0.9, step: 0.01, default: 0.55, group: "Form" },
  { id: "width", label: "Stärke", type: "range", min: 0.5, max: 6, step: 0.1, default: 1.6, group: "Form" },
  { id: "layers", label: "Ebenen", type: "range", min: 1, max: 5, step: 1, default: 3, group: "Struktur" },
  { id: "curl", label: "Krümmung", type: "range", min: 0, max: 2, step: 0.01, default: 0.8, group: "Struktur" },
  { id: "glow", label: "Licht", type: "toggle", default: true, group: "Struktur" },
  { id: "sway", label: "Schwingen", type: "range", min: 0, max: 1, step: 0.01, default: 0.45, group: "Bewegung" },
  { id: "flow", label: "Strömung", type: "range", min: 0, max: 3, step: 0.01, default: 1.2, group: "Bewegung" },
  { id: "bg", label: "Hintergrund", type: "color", default: "#0b1a22" },
  { id: "body", label: "Halme", type: "color", default: "#3fa37a" },
  { id: "light", label: "Licht", type: "color", default: "#f4e9c8" },
  { id: "seed", label: "Seed", type: "seed", default: 7 }
];

let blades = [];
function setup(ctx, p, rng) {
  blades = [];
  for (let i = 0; i < p.blades; i++) {
    blades.push({ x: rng(), layer: Math.floor(rng() * p.layers), h: 0.6 + rng() * 0.4, off: rng() * 100, lean: rng() - 0.5 });
  }
  blades.sort((a, b) => a.layer - b.layer);              // back to front
}

function draw(ctx, p, t, rng) {
  const W = ctx.canvas.width, H = ctx.canvas.height, S = Math.min(W, H);
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  if (p.glow) {                                          // soft light source for depth
    const g = ctx.createRadialGradient(W * 0.7, H * 0.25, 0, W * 0.7, H * 0.25, S * 0.9);
    g.addColorStop(0, rgba(p.light, 0.35));
    g.addColorStop(1, rgba(p.light, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.lineCap = "round";
  for (const b of blades) {
    const depth = (b.layer + 1) / p.layers;               // 0..1, front = 1
    const baseX = b.x * W, baseY = H * (0.85 + 0.15 * depth);
    const len = S * p.height * b.h * (0.6 + 0.4 * depth);
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const u = k / 10;
      const n = loopNoise(b.off + u * p.curl, depth * 3, t, p.flow * 0.3, b.off);   // seamless motion
      const bend = (b.lean * p.curl + n * p.sway) * u * u;                          // stronger toward the tip
      pts.push([baseX + bend * len, baseY - u * len]);
    }
    ctx.strokeStyle = mix(p.body, p.bg, 0.6 * (1 - depth));                        // far = misty
    ctx.globalAlpha = 0.55 + 0.45 * depth;
    ctx.lineWidth = S * 0.001 * p.width * (0.5 + depth);
    ctx.beginPath();
    smoothPath(ctx, pts);
    ctx.stroke();
    if (p.glow) {                                         // highlight at the tip
      const tip = pts[pts.length - 1];
      ctx.fillStyle = rgba(p.light, 0.5 * depth);
      ctx.beginPath();
      ctx.arc(tip[0], tip[1], ctx.lineWidth * 0.8, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
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

  // Mit Bild: Modelle, die Bilder lesen können, sehen die Referenz direkt (Lage, Proportionen, Licht)
  function messages(promptText, imageBase64) {
    const user = { role: 'user', content: promptText };
    if (imageBase64) { user.images = [imageBase64]; user.content += '\n\nThe reference image is attached – match its composition, proportions, lighting and details.'; }
    return [{ role: 'system', content: SYSTEM }, user];
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

  /* ---------- Bildvergleich (Art Director) ---------- */
  const REVIEW_SYSTEM = 'You are a strict art director. You compare a rendered frame of a generative program with its reference image and give precise, actionable feedback. Answer in German.';
  // Ein einziges Vergleichsbild: links REFERENZ, rechts ERGEBNIS (kleine Modelle verwechseln sonst die Bilder)
  function reviewMessages(compareBase64, analysis) {
    return [
      { role: 'system', content: REVIEW_SYSTEM },
      { role: 'user', images: [compareBase64], content: `Das Bild ist zweigeteilt. LINKS (beschriftet „REFERENZ“) ist die Vorlage${analysis && analysis.title ? ` („${analysis.title}“)` : ''}. RECHTS (beschriftet „ERGEBNIS“) ist ein Einzelbild eines generativen Programms, das Motiv und Stil der Vorlage nachbilden soll.
Beschreibe Unterschiede immer so: „Im ERGEBNIS … , in der REFERENZ …“.
Bewerte die Ähnlichkeit (score 1–10): Motiv, Komposition und Größenverhältnisse, Formen, Farben, feine Details/Texturen, Volumen/Licht.
- matches: was bereits gut passt
- problems: die 3–6 wichtigsten konkreten Unterschiede
- improvements: konkrete, umsetzbare Anweisungen an den Programmierer, z. B. „Hauptkörper doppelt so groß, diagonal von links unten nach rechts oben“, „statt Zickzack-Linie 400 feine, weiche, halbtransparente Härchen am Rand“, „Körper mit radialem Verlauf schattieren, Glanzlicht oben rechts“.` },
    ];
  }

  /* Überarbeitung nach dem Bildvergleich */
  function refine(base, code, review, compareBase64) {
    const user = { role: 'user', content: '' };
    if (compareBase64) user.images = [compareBase64];
    return [...base,
      { role: 'assistant', content: JSON.stringify({ code }) },
      { ...user, content: `${compareBase64 ? 'Attached: LEFT = reference, RIGHT = current frame of your generator.\n' : ''}An art director compared a rendered frame of your generator with the reference image. Similarity: ${review.score}/10.
Already good:
${(review.matches || []).map(x => '- ' + x).join('\n') || '- (nothing)'}
Problems:
${(review.problems || []).map(x => '- ' + x).join('\n')}
Do this:
${(review.improvements || []).map(x => '- ' + x).join('\n')}

Rewrite the generator so the frame looks much closer to the reference. Follow the QUALITY rules and use the helpers (smoothPath, noise/loopNoise, gradients).
Keep the contract; you may add or change params. Reply with the JSON object {"code": "<complete file>"} and nothing else.` }];
  }

  return { VERSION, analysisMessages, build, messages, repair, reviewMessages, refine, describe, CONTRACT, EXAMPLE };
})();
