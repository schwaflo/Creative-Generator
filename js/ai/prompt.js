'use strict';
/* KI: Auftrag – der Generator ist nur das Interface, die KI baut die Funktion.
   Der Auftrag erklärt genau, wie die App Regler und Dropdowns aus der Parameterliste baut und wie sie im Shader
   ankommen. Alles Gestalterische entscheidet das Modell.
   Drei Wege zur Aufgabe: Bild (Modell sieht es selbst) · Bildbeschreibung (von einem zweiten Modell) · nur Text.
   Bei Änderungen am Auftrag: VERSION erhöhen (wird mit jedem Generator gespeichert). */
CG.ai = CG.ai || {};
CG.ai.prompt = (() => {
  const VERSION = 'funktion-v2';
  const SLOT = '{{BILDBESCHREIBUNG}}';             // wird durch die Beschreibung des zweiten Modells ersetzt

  const SYSTEM = 'You are a creative coder. You build visual functions (animated GLSL shaders with their own controls) for a generative design app. You always answer with exactly one JSON object {"title", "notes", "params", "shader"}.';

  // kurzes, korrektes Beispiel (zeigt Format, Dropdown und Hilfsfunktionen – kein gestalterisches Vorbild)
  const EXAMPLE = JSON.stringify({
    title: 'Farbwolken', notes: 'Zwei Farben, verwirbeltes Rauschen; das Dropdown schaltet zwischen Wolken und Streifen.',
    params: [
      { id: 'mode', label: 'Muster', type: 'select', options: ['Wolken', 'Streifen'], default: 'Wolken', group: 'Form' },
      { id: 'scale', label: 'Maßstab', type: 'range', min: 0.5, max: 8, step: 0.01, default: 3, group: 'Form' },
      { id: 'speed', label: 'Tempo', type: 'range', min: 0, max: 2, step: 0.01, default: 0.5, group: 'Bewegung' },
      { id: 'a', label: 'Farbe 1', type: 'color', default: '#12203a' },
      { id: 'b', label: 'Farbe 2', type: 'color', default: '#f2a65a' },
      { id: 'seed', label: 'Seed', type: 'seed', default: 7 }],
    shader: ['void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
      '  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;',
      '  vec2 q = uv * u_scale + u_seed * 0.37;',
      '  float t = iTime * u_speed;',
      '  float v;',
      '  if (u_mode < 0.5) v = fbm(q + vec2(fbm(q + t * 0.2), fbm(q - t * 0.15)));',
      '  else v = 0.5 + 0.5 * sin(q.y * 6.0 + 2.0 * noise(q + t * 0.3));',
      '  vec3 col = mix(u_a, u_b, smoothstep(0.25, 0.75, v));',
      '  fragColor = vec4(col, 1.0);',
      '}'].join('\n') });

  // Das Interface: was die App bereitstellt und wie Regler funktionieren
  const INTERFACE = `The app is only the interface: it shows your function live, builds the control panel from your parameter list, plays it as a loop and exports images and video. Everything visual is your decision.

Answer with one JSON object:
- "title": a short German name
- "notes": a few sentences – what you build and how
- "params": the list of controls (see below) – you decide which and how many
- "shader": the GLSL code as one string

How controls work – every entry in "params" becomes one control in the panel AND one uniform in your shader, named u_<id>:
- Slider:   {"id": "speed", "label": "Tempo", "type": "range", "min": 0, "max": 2, "step": 0.01, "default": 1}
            -> uniform float u_speed (the current slider value)
- Color:    {"id": "ink", "label": "Tinte", "type": "color", "default": "#2ec4b6"}
            -> uniform vec3 u_ink (rgb, each 0..1)
- Dropdown: {"id": "mode", "label": "Muster", "type": "select", "options": ["Wellen", "Kreise", "Linien"], "default": "Wellen"}
            -> uniform float u_mode = index of the chosen option (0.0, 1.0, 2.0 …). Use it like this:
               if (u_mode < 0.5) { /* Wellen */ } else if (u_mode < 1.5) { /* Kreise */ } else { /* Linien */ }
- Switch:   {"id": "glow", "label": "Leuchten", "type": "toggle", "default": true}
            -> uniform float u_glow (1.0 = on, 0.0 = off)
- Seed:     {"id": "seed", "label": "Seed", "type": "seed", "default": 7}
            -> uniform float u_seed (0..9999; the user rolls it to get a new random variation)
- Optional "group": "Form" (any short German name): controls with the same group share one section of the panel. Colors always appear together as a palette.
- "id": letters, digits and underscore only. "label": German. The app declares the uniforms – do not declare them yourself. Every u_<id> you use in the shader must be in "params".

The shader – Shadertoy style, GLSL ES 3.0:
  void mainImage(out vec4 fragColor, in vec2 fragCoord) { … }   plus any helper functions you write yourself.
Available: iResolution (vec3, size in pixels), iTime (float, seconds), iLoop (float 0..1, position in the loop – use it for seamless loops), and your u_<id> uniforms.
Not available: textures / iChannel, #version, main().

Helpers you may call without defining them – prefer them over writing your own noise or hash: hash(float | vec2 | vec3) -> float 0..1 · noise(vec2 | vec3) -> smooth float 0..1 · fbm(vec2 | vec3) -> float 0..1 · rot(float angle) -> mat2 · smin(float a, float b, float k) smooth minimum · palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) -> vec3.

GLSL ES is strict – these mistakes break shaders most often, avoid them:
- Write floats with a decimal point (2.0, not 2). int and float never mix – convert with float(i).
- Call a function only with the argument types it is declared with, and declare it above the place where it is used.
- A vec3 is not a float: use .x/.r, length(v) or vec3(x) to convert.
- The names are fract, mix, mod, atan(y, x) – not frac, lerp, fmod, atan2. Time is iTime, size is iResolution.xy.
- Global variables must be constant; compute everything that uses uniforms or iTime inside a function.

Example of a correct answer (only to show the format – build something of your own):
${EXAMPLE}`;

  // Aufgabe je nach Weg
  function task({ source, wishes }) {
    const w = (wishes || '').trim();
    if (source === 'image') return `Task: attached is a reference image. Build a function that recreates it as closely as you can – subject, composition, colors, light, fine detail – as a living, animated image.\nMy wish: ${w || '(none)'}`;
    if (source === 'description') return `Task: build a function that recreates a reference image as closely as you can, as a living, animated image. You cannot see the image; a vision model described it for you:\n${SLOT}\nMy wish: ${w || '(none)'}`;
    return `Task: ${w || '(describe here what the function should show)'}`;
  }

  // Der sichtbare, editierbare Auftrag
  function text({ wishes, format, source = 'image' } = {}) {
    const f = format ? `${format.w} × ${format.h} px (${format.w >= format.h ? 'landscape' : 'portrait'})` : 'any';
    return `${task({ source, wishes })}\nFormat: ${f} – it must work in any size.\n\n${INTERFACE}`;
  }

  function messages(promptText, imageBase64) {
    const user = { role: 'user', content: promptText };
    if (imageBase64) user.images = [imageBase64];
    return [{ role: 'system', content: SYSTEM }, user];
  }

  // Bildbeschreibung durch ein zweites Modell (für Modelle, die keine Bilder lesen können)
  const DESCRIBE = `Describe this image for a shader programmer who cannot see it and has to recreate it procedurally. Be precise and concrete:
- subject and overall structure, how the parts connect
- composition: where things are (as fractions of the image), sizes, what is in front and behind
- colors as hex values, gradients
- materials and surface (transparent, glossy, grainy, soft …), light direction, shadows, depth of field
- fine detail and texture, mood
Plain text, about 150–250 words, no introduction.`;
  const describeMessages = imageBase64 => [{ role: 'user', content: DESCRIBE, images: [imageBase64] }];

  // Vergleich durch das zweite Modell (links Referenz, rechts Ergebnis) – als Text für das Code-Modell
  const CRITIQUE = `LEFT = the reference image, RIGHT = what a shader currently renders. For the programmer who cannot see either: list the most important differences, most important first – structure and shapes, composition, colors (hex), light, texture. Say concretely what must change in the RIGHT image. Plain text, at most 150 words.`;
  const critiqueMessages = compareBase64 => [{ role: 'user', content: CRITIQUE, images: [compareBase64] }];

  // Nächste Runde im selben Gespräch: Fehler beheben · selbst vergleichen (Bild) · Kritik des zweiten Modells (Text)
  function feedback(history, answer, { compareBase64, critique, errors, warnings }) {
    const tail = `${warnings && warnings.length ? `\nThe automatic test also noticed:\n${warnings.map(w => '- ' + w).join('\n')}` : ''}\nAnswer with the full JSON {"title", "notes", "params", "shader"}.`;
    let content;
    if (errors && errors.length) content = `Your shader does not work yet. The automatic test reports:\n${errors.map(e => '- ' + e).join('\n')}\nFix all of it. Answer with the full JSON {"title", "notes", "params", "shader"} again.`;
    else if (critique) content = `A vision model compared the reference with what your shader renders:\n${critique}\nImprove the function accordingly. Keep everything that already works.${tail}`;
    else content = `Attached: LEFT = the reference, RIGHT = what your current shader renders. Compare them carefully yourself: what is still different in composition, shapes, colors, light and detail? Write that into "notes", then improve the function. Keep everything that already works.${tail}`;
    const next = { role: 'user', content };
    if (compareBase64 && !critique && !(errors && errors.length)) next.images = [compareBase64];
    return [...history, { role: 'assistant', content: JSON.stringify(answer) }, next];
  }

  /* Bestehenden Generator per Prompt ändern: Das Modell bekommt die aktuelle Funktion (Regler + Shader),
     den Änderungswunsch und – wenn es Bilder lesen kann – ein Bild des aktuellen Ergebnisses. */
  function improveText({ gen, request }) {
    const current = { title: gen.name, params: gen.params, shader: gen.code };
    return `Task: change an existing function of the app. Here is the current function:\n${JSON.stringify(current, null, 1)}\n\nChange request: ${(request || '').trim()}\n\nApply the request. Keep everything else as it is; keep the ids of existing controls, add or remove controls only if the request needs it. Answer with the full updated JSON.\n\n${INTERFACE}`;
  }
  function improveMessages(promptText, imageBase64) {
    const user = { role: 'user', content: promptText + (imageBase64 ? '\n\nAttached: what the current function renders.' : '') };
    if (imageBase64) user.images = [imageBase64];
    return [{ role: 'system', content: SYSTEM }, user];
  }

  return { VERSION, SLOT, SYSTEM, INTERFACE, EXAMPLE, text, messages, describeMessages, critiqueMessages, feedback, improveText, improveMessages };
})();
