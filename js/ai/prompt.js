'use strict';
/* KI: Prompt – so, wie man einen guten Coding-Assistenten fragt.
   Ein Gespräch: Das Modell sieht das Bild, beschreibt, plant, legt seine Regler fest und schreibt einen GLSL-Shader.
   Danach sieht es sein gerendertes Ergebnis neben der Referenz und verbessert selbst.
   Bei Änderungen an Regeln/Beispiel: VERSION erhöhen (wird mit jedem Generator gespeichert). */
CG.ai = CG.ai || {};
CG.ai.prompt = (() => {
  const VERSION = 'shader-v2';

  const SYSTEM = 'You are a world-class shader artist (think Shadertoy and Inigo Quilez). You recreate reference images as procedural, animated GLSL shaders. You always answer with a JSON object {"title", "notes", "params", "shader"}.';

  // funktionierendes Beispiel im Format (für Tests und Doku – steht nicht im Prompt, damit es das Modell nicht beeinflusst)
  const EXAMPLE = JSON.stringify({
    title: 'Weiche Wellen',
    notes: 'Sehe: weiche Farbverläufe … Plan: zwei Farben, verwirbeltes Rauschen, langsame Bewegung.',
    params: [
      { id: 'a', label: 'Farbe 1', type: 'color', default: '#1b2a4a' },
      { id: 'b', label: 'Farbe 2', type: 'color', default: '#f2a65a' },
      { id: 'scale', label: 'Maßstab', type: 'range', min: 0.5, max: 6, step: 0.01, default: 2.5 },
      { id: 'speed', label: 'Tempo', type: 'range', min: 0, max: 2, step: 0.01, default: 0.6 },
      { id: 'seed', label: 'Seed', type: 'seed', default: 7 },
    ],
    shader: [
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }',
      'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
      '  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y * u_scale + u_seed;',
      '  float t = iTime * u_speed;',
      '  float n = noise(uv + vec2(noise(uv * 1.7 + t), noise(uv * 1.3 - t)));',
      '  fragColor = vec4(mix(u_a, u_b, smoothstep(0.2, 0.8, n)), 1.0);',
      '}'].join('\n'),
  }, null, 2);

  // Der sichtbare, editierbare Auftrag (ohne Bild – das Bild wird angehängt)
  function text({ wishes, format } = {}) {
    const f = format ? `${format.w} × ${format.h} px (${format.w >= format.h ? 'landscape' : 'portrait'}, aspect ${(format.w / format.h).toFixed(3)})` : 'any';
    return `Here is a reference image. Recreate it as a procedural, animated shader – as close to the image as you can. Use whatever techniques you think fit best.

My wish: ${wishes && wishes.trim() ? wishes.trim() : '(none)'}
Format: ${f}

Answer as JSON:
- "title": a short German name
- "notes": what you see and how you will build it
- "params": the controls you find useful, labels in German. Types: "range" (min, max, step, default), "color" (default "#rrggbb"), "select" (options, default), "toggle" (default), "seed" (default). Optional "group".
- "shader": Shadertoy-style GLSL (ES 3.0):  void mainImage(out vec4 fragColor, in vec2 fragCoord)  plus your own functions.
  Available: iResolution, iTime (seconds), and every param as a uniform u_<id> – float for range/seed/toggle (0/1)/select (option index), vec3 for color. No textures or iChannel, no #version.`;
  }

  function messages(promptText, imageBase64) {
    const user = { role: 'user', content: promptText };
    if (imageBase64) user.images = [imageBase64];
    return [{ role: 'system', content: SYSTEM }, user];
  }

  // Nächste Runde im selben Gespräch: Fehler beheben oder das eigene Ergebnis mit der Referenz vergleichen
  function feedback(history, answer, { compareBase64, errors, warnings }) {
    const next = { role: 'user', content: errors && errors.length
      ? `Your shader does not work yet. The automatic test reports:\n${errors.map(e => '- ' + e).join('\n')}\nFix all of it. Answer with the full JSON {"title", "notes", "params", "shader"} again.`
      : `Attached: LEFT = the reference, RIGHT = what your current shader renders. Compare them carefully yourself, as a demanding art director:
what is still different in composition, shapes, connections, materials, colors, light and fine detail? Write that into "notes", then improve the shader.
Keep everything that already works.${warnings && warnings.length ? `\nThe automatic test also noticed:\n${warnings.map(w => '- ' + w).join('\n')}` : ''}
Answer with the full JSON {"title", "notes", "params", "shader"}.` };
    if (compareBase64 && !(errors && errors.length)) next.images = [compareBase64];
    return [...history, { role: 'assistant', content: JSON.stringify(answer) }, next];
  }

  return { VERSION, SYSTEM, EXAMPLE, text, messages, feedback };
})();
