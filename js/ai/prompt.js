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
  /* Auftrag ohne Vertrag (für den Ebenen-Modus: Planung und jede Ebene bekommen ihn als Kontext) */
  function brief({ analysis, wishes, format }) {
    const a = analysis || {};
    const colors = (a.colors || []).map(c => c.hex).filter(Boolean);
    const aspect = format ? `${format.w} × ${format.h} px (Seitenverhältnis ${(format.w / format.h).toFixed(3)})` : 'beliebig';
    return `# TASK
Create a generative-art animation that recreates the visual style of the reference image described below.
Capture its subject, composition, colors, shapes, structure, texture and mood as a parametric system with meaningful controls.

# REFERENCE IMAGE (analysis)
${describe(a) || '- (keine Analyse)'}

# REQUIREMENTS
- Target format: ${aspect}. The composition must also adapt to any other width/height.
- Colors of the reference: ${colors.length ? colors.join(', ') : 'choose a fitting palette'}.
- Animation: a calm, seamless loop that fits the image (motion hint: ${a.motion || 'subtle drift'}).
${wishes && wishes.trim() ? `- Additional wishes of the user (high priority):\n${wishes.trim().split('\n').map(s => '  ' + s).join('\n')}\n` : ''}`;
  }

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

  /* ================= Ebenen-Modus =================
     1. Planung: Das Vision-Modell zerlegt die Referenz in Ebenen (von hinten nach vorne).
     2. Jede Ebene schreibt das Code-Modell als eigene kleine Datei; die App setzt sie zusammen. */
  const PLAN_SYSTEM = 'You are a technical art director for generative graphics. You break a reference image into a few drawable layers for an HTML canvas program and describe each layer precisely (what, where, look, motion, technique). Answer in German, keep JSON keys in English.';
  function planMessages(briefText, imageBase64) {
    const user = { role: 'user', content: `${briefText}
# AUFGABE
Zerlege die Referenz in 2–5 Ebenen für ein Canvas-2D-Programm, von hinten nach vorne. Der einfarbige Hintergrund ist keine Ebene (nur "background" als Hex-Farbe).
Für jede Ebene:
- id: kurzer englischer Bezeichner in camelCase (z. B. "body", "hairs", "flagella", "waves")
- name: kurzer deutscher Name (z. B. "Körper", "Härchen", "Geißeln")
- what: was genau gezeichnet wird, mit Form und Anzahl (z. B. „abgerundeter Zylinder (Kapsel), Länge 0.55 der Bildbreite, Dicke 0.16“)
- where: Lage und Größe in Bildanteilen 0..1 (x von links, y von oben), z. B. „von (0.45, 0.62) nach (0.85, 0.22), also diagonal von links unten nach rechts oben“
- look: Farben (Hex), Linienstärke, Transparenz, Licht und Schatten
- motion: nahtlose Loop-Bewegung dieser Ebene
- technique: wie man es mit Canvas 2D gut umsetzt (z. B. „radialGradient mit Glanzlicht oben rechts“, „800 kurze smoothPath-Härchen entlang der Kontur, halbtransparent“, „120 lange Fäden mit loopNoise, gebündelt am linken Ende“)` };
    if (imageBase64) user.images = [imageBase64];
    return [{ role: 'system', content: PLAN_SYSTEM }, user];
  }

  const LAYER_CONTRACT = `Write the code of ONE LAYER as a plain JavaScript file (no import/export). The app combines all layers (back to front) into one animation.
Define exactly:

  const params = [ ... ];                 // 2–6 controls for THIS layer only
  function setup(ctx, p, rng) { ... }     // optional: precompute data
  function draw(ctx, p, t, rng) { ... }   // draws ONLY this layer

PARAMETER ENTRIES (labels in German):
  { id: "count", label: "Anzahl", type: "range", min: 10, max: 2000, step: 1, default: 600 }
  type "range": numeric min, max, step, default · type "color": default "#rrggbb" · type "select": options + default · type "toggle": default true/false
  Do not define "seed", "bg" or "speed" – these are global.

RULES
1. Do NOT fill or clear the background – the background and the layers below are already drawn. Paint only this layer's shapes.
2. Size: const W = ctx.canvas.width, H = ctx.canvas.height, S = Math.min(W, H). Positions as fractions of W/H, sizes relative to S – never fixed pixels.
3. t runs 0..1 and loops seamlessly. Use a = 2 * Math.PI * t * p.speed (p.speed is a global integer 1..3) or loopNoise(…, t, …).
   No state between frames: a frame depends only on (p, t) and data from setup().
4. p holds this layer's params plus globals p.bg (background color) and p.speed. Randomness only via rng() (seeded).
5. Forbidden: document, window, fetch, import, eval, setTimeout, requestAnimationFrame, images. At most ~15000 shapes, no unbounded loops.
6. Reply with a JSON object {"code": "<the complete layer file>"} and nothing else.`;

  const helpersAndQuality = () => CONTRACT.slice(CONTRACT.indexOf('HELPERS ('));

  const LAYER_EXAMPLE = `const params = [
  { id: "count", label: "Anzahl", type: "range", min: 50, max: 3000, step: 1, default: 900 },
  { id: "length", label: "Länge", type: "range", min: 0.005, max: 0.08, step: 0.001, default: 0.025 },
  { id: "spread", label: "Streuung", type: "range", min: 0, max: 1, step: 0.01, default: 0.4 },
  { id: "color", label: "Farbe", type: "color", default: "#f2efe6" }
];
let seeds = [];
function setup(ctx, p, rng) {
  seeds = [];
  for (let i = 0; i < p.count; i++) seeds.push({ u: rng(), side: rng() < 0.5 ? -1 : 1, len: 0.5 + rng(), off: rng() * 50 });
}
function draw(ctx, p, t, rng) {
  const W = ctx.canvas.width, H = ctx.canvas.height, S = Math.min(W, H);
  // fine fibres along a gentle arc from (0.2, 0.7) to (0.8, 0.3)
  ctx.lineCap = "round";
  ctx.strokeStyle = p.color;
  for (const s of seeds) {
    const x = W * lerp(0.2, 0.8, s.u), y = H * (lerp(0.7, 0.3, s.u) - 0.08 * Math.sin(s.u * Math.PI));
    const ang = Math.atan2(-0.4 * H, 0.6 * W) + s.side * Math.PI / 2 + loopNoise(s.off, s.u * 3, t * p.speed, 0.6) * p.spread;
    const L = S * p.length * s.len;
    ctx.globalAlpha = 0.25 + 0.5 * s.len / 1.5;
    ctx.lineWidth = S * 0.0012;
    ctx.beginPath();
    smoothPath(ctx, [[x, y], [x + Math.cos(ang) * L * 0.5, y + Math.sin(ang) * L * 0.5 + L * 0.1], [x + Math.cos(ang) * L, y + Math.sin(ang) * L]]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}`;

  const fmtLayer = (L, i) => `${i + 1}. ${L.name} (${L.id}): ${L.what} | Lage: ${L.where} | Look: ${L.look} | Bewegung: ${L.motion} | Technik: ${L.technique}`;

  function layerMessages(briefText, plan, index, imageBase64) {
    const L = plan.layers[index];
    const user = { role: 'user', content: `${briefText}
# LAYER PLAN (back to front; background color ${plan.background} is drawn by the app)
${plan.layers.map((x, i) => fmtLayer(x, i) + (i === index ? '   <== YOU WRITE THIS LAYER' : i < index ? '   (already done)' : '   (comes later, do not draw it)')).join('\n')}

# YOUR TASK
Write layer ${index + 1} „${L.name}“.
- What: ${L.what}
- Where: ${L.where}
- Look: ${L.look}
- Motion: ${L.motion}
- Technique: ${L.technique}
Make it rich and detailed – this layer alone must look professional.

# LAYER CONTRACT (must be followed exactly)
${LAYER_CONTRACT}

${helpersAndQuality()}

# EXAMPLE LAYER (different subject – shows the format only)
\`\`\`js
${LAYER_EXAMPLE}
\`\`\`
${imageBase64 ? '\nThe reference image is attached – match position, size, colors and detail of this layer.' : ''}
Reply with the JSON object {"code": "..."} only.` };
    if (imageBase64) user.images = [imageBase64];
    return [{ role: 'system', content: SYSTEM }, user];
  }

  // Bewertung einer einzelnen Ebene (im Vergleichsbild ist alles bis einschließlich dieser Ebene gezeichnet)
  function layerReviewMessages(compareBase64, plan, index) {
    const L = plan.layers[index];
    return [
      { role: 'system', content: REVIEW_SYSTEM },
      { role: 'user', images: [compareBase64], content: `Das Bild ist zweigeteilt. LINKS („REFERENZ“) die Vorlage, RECHTS („ERGEBNIS“) ein generatives Programm im Aufbau.
Im ERGEBNIS sind bisher nur diese Ebenen gezeichnet: ${plan.layers.slice(0, index + 1).map(x => x.name).join(', ')}. Weitere Ebenen folgen später – bewerte deren Fehlen NICHT.
Bewerte nur die zuletzt hinzugefügte Ebene „${L.name}“ (soll: ${L.what}; Lage: ${L.where}; Look: ${L.look}).
score 1–10: wie gut entspricht diese Ebene in Lage, Größe, Form, Farbe und Detail der REFERENZ?
problems und improvements nur zu dieser Ebene, konkret („Im ERGEBNIS … , in der REFERENZ …“).` },
    ];
  }

  // Ebene überarbeiten (nach Bewertung) bzw. reparieren (nach Fehlern)
  function layerRefine(layerMsgs, code, review, compareBase64) {
    const user = { role: 'user', content: `${compareBase64 ? 'Attached: LEFT = reference, RIGHT = current state with your layer.\n' : ''}An art director rated your layer ${review.score}/10.
Problems:
${review.problems.map(x => '- ' + x).join('\n')}
Do this:
${review.improvements.map(x => '- ' + x).join('\n')}
Rewrite the layer accordingly (same contract, draw only this layer). Reply with {"code": "<complete layer file>"} only.` };
    if (compareBase64) user.images = [compareBase64];
    return [...layerMsgs, { role: 'assistant', content: JSON.stringify({ code }) }, user];
  }

  return { VERSION, analysisMessages, build, brief, messages, repair, reviewMessages, refine, describe, CONTRACT, EXAMPLE,
    planMessages, layerMessages, layerReviewMessages, layerRefine, LAYER_CONTRACT, LAYER_EXAMPLE };
})();
