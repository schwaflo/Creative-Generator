'use strict';
/* KI: Auftrag – der Generator ist nur das Interface, die KI baut die Funktion.
   Der Auftrag erklärt genau, wie die App Regler und Dropdowns aus der Parameterliste baut und wie sie im Shader
   ankommen. Alles Gestalterische entscheidet das Modell.
   Drei Wege zur Aufgabe: Bild (Modell sieht es selbst) · Bildbeschreibung (von einem zweiten Modell) · nur Text.
   Bei Änderungen am Auftrag: VERSION erhöhen (wird mit jedem Generator gespeichert). */
CG.ai = CG.ai || {};
CG.ai.prompt = (() => {
  const VERSION = 'funktion-v5';
  const SLOT = '{{BILDBESCHREIBUNG}}';             // wird durch die Beschreibung des zweiten Modells ersetzt

  const SYSTEM = 'You are a creative coder who writes generative GLSL shaders with their own controls.';

  /* Antwortform: freier Text mit zwei Code-Blöcken statt eines JSON-Objekts – Code im JSON-String (alles maskiert,
     Grammatik-Zwang beim Erzeugen) schreiben Modelle messbar schlechter. */
  const F = '```';
  function format(a) {
    return `TITLE: ${a.title || ''}\nNOTES: ${String(a.notes || '').replace(/\s*\n\s*/g, ' ')}\n${F}json\n${JSON.stringify(a.params || [], null, 1)}\n${F}\n${F}glsl\n${String(a.shader || '').trim()}\n${F}`;
  }

  // kurzes, korrektes Beispiel – nur für Tests und Doku, steht nicht im Auftrag (es würde den Stil prägen)
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

  /* Das Interface – bewusst knapp: nur was das Modell wissen muss, damit die App seine Funktion ausführen kann.
     Keine Stil- oder Technikvorgaben, keine Regelliste, kein Beispiel (das prägt sonst den Stil).
     Typische GLSL-Fehler fängt die App selbst ab (shader.tidy / rescueGreedy, Hilfsfunktionen bei Bedarf). */
  const INTERFACE = `Controls: you decide which controls fit your idea and how many – name them yourself (id in English, label in German). Each one becomes a uniform u_<id> in your shader:
- slider: {"id", "label", "type": "range", "min", "max", "step", "default"} -> float
- color: {"id", "label", "type": "color", "default": "#rrggbb"} -> vec3 (rgb 0..1)
- dropdown: {"id", "label", "type": "select", "options": [ ... ], "default"} -> float = index of the chosen option (0.0, 1.0, …)
- switch: {"id", "label", "type": "toggle", "default": true or false} -> float (1.0 or 0.0)
- random seed: {"id", "label", "type": "seed", "default"} -> float (the user rolls it for a new variation)
Optional "group" sorts controls into sections.

The shader is Shadertoy-style GLSL ES 3.0: void mainImage(out vec4 fragColor, in vec2 fragCoord) with iResolution (vec3 – use iResolution.xy with fragCoord), iTime, iLoop (0..1, for seamless loops) and your u_<id> – plus any functions you write yourself. No textures.

Answer like this:
TITLE: <short German name>
NOTES: <your idea in a few sentences>
${F}json
[ your controls ]
${F}
${F}glsl
<the complete shader>
${F}`;

  // Aufgabe je nach Weg
  function task({ source, wishes }) {
    const w = (wishes || '').trim(), wish = w ? `\nMy wish: ${w}` : '';
    if (source === 'image') return `Here is a reference image. Turn it into a generative function: an animated shader that captures what makes this image – its forms, composition, colors, light and mood. How you translate it is up to you.${wish}`;
    if (source === 'description') return `Turn a reference image into a generative function: an animated shader that captures what makes this image – its forms, composition, colors, light and mood. You cannot see the image; a vision model described it:\n${SLOT}${wish}`;
    return `Build a generative function: an animated shader. ${w || '(describe here what it should show)'}`;
  }

  // Der sichtbare, editierbare Auftrag
  function text({ wishes, format, source = 'image' } = {}) {
    const f = format ? `${format.w} × ${format.h} px (${format.w >= format.h ? 'landscape' : 'portrait'})` : 'any';
    return `${task({ source, wishes })}\nFormat: ${f}.\n\n${INTERFACE}`;
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
    const again = 'Answer again in the same format (TITLE, NOTES, json, glsl).';
    const notes = warnings && warnings.length ? `\nNoticed while testing: ${warnings.join(' ')}` : '';
    let content;
    if (errors && errors.length) content = `The shader does not run yet:\n${errors.map(e => '- ' + e).join('\n')}\nFix this. ${again}`;
    else if (critique) content = `A vision model compared the reference with your result:\n${critique}\nWhat would bring it closer? Improve it.${notes}\n${again}`;
    else content = `Attached: LEFT the reference, RIGHT what your shader renders now. What would bring it closer? Improve it.${notes}\n${again}`;
    const next = { role: 'user', content };
    if (compareBase64 && !critique && !(errors && errors.length)) next.images = [compareBase64];
    return [...history, { role: 'assistant', content: format(answer) }, next];
  }

  /* Bestehenden Generator per Prompt ändern: Das Modell bekommt die aktuelle Funktion (Regler + Shader),
     den Änderungswunsch und – wenn es Bilder lesen kann – ein Bild des aktuellen Ergebnisses. */
  function improveText({ gen, request }) {
    const current = { title: gen.name, notes: '(current version)', params: gen.params, shader: gen.code };
    return `Task: change an existing function of the app. Here is the current function:\n${format(current)}\n\nChange request: ${(request || '').trim()}\n\nApply the request. Keep everything else as it is; keep the ids of existing controls, add or remove controls only if the request needs it. Answer with the complete updated function.\n\n${INTERFACE}`;
  }
  function improveMessages(promptText, imageBase64) {
    const user = { role: 'user', content: promptText + (imageBase64 ? '\n\nAttached: what the current function renders.' : '') };
    if (imageBase64) user.images = [imageBase64];
    return [{ role: 'system', content: SYSTEM }, user];
  }

  return { VERSION, SLOT, SYSTEM, INTERFACE, EXAMPLE, format, text, messages, describeMessages, critiqueMessages, feedback, improveText, improveMessages };
})();
