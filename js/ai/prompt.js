'use strict';
/* KI: Prompt – so, wie man einen guten Coding-Assistenten fragt.
   Ein Gespräch: Das Modell sieht das Bild, beschreibt, plant, legt seine Regler fest und schreibt einen GLSL-Shader.
   Danach sieht es sein gerendertes Ergebnis neben der Referenz und verbessert selbst.
   Bei Änderungen an Regeln/Beispiel: VERSION erhöhen (wird mit jedem Generator gespeichert). */
CG.ai = CG.ai || {};
CG.ai.prompt = (() => {
  const VERSION = 'shader-v1';

  const SYSTEM = 'You are a world-class shader artist (think Shadertoy and Inigo Quilez). You study reference images very carefully and recreate them as rich, procedural, animated GLSL fragment shaders. You always answer with a JSON object {"title", "notes", "params", "shader"}.';

  // kurzes, funktionierendes Beispiel (anderes Motiv – zeigt nur Format und Technik)
  const EXAMPLE = `{
  "title": "Tintentropfen",
  "notes": "Sehe: dunkles Wasser, sich windende Tinte, einige glänzende Tropfen … Plan: Hintergrund-Verlauf, domain-warped loopFbm für die Tinte, Tropfen als SDF-Kreise mit Kugel-Normalen, Glanzlicht und Fresnel-Rand.",
  "params": [
    { "id": "bg", "label": "Wasser", "type": "color", "default": "#0d1b2a" },
    { "id": "ink", "label": "Tinte", "type": "color", "default": "#2ec4b6" },
    { "id": "scale", "label": "Maßstab", "type": "range", "min": 0.5, "max": 4, "step": 0.01, "default": 1.6, "group": "Form" },
    { "id": "swirl", "label": "Verwirbelung", "type": "range", "min": 0, "max": 2, "step": 0.01, "default": 0.9, "group": "Struktur" },
    { "id": "drops", "label": "Tropfen", "type": "range", "min": 0, "max": 8, "step": 1, "default": 4, "group": "Form" },
    { "id": "seed", "label": "Seed", "type": "seed", "default": 7 }
  ],
  "shader": "vec3 image(vec2 uv, vec2 p, float t) {\\n  vec3 col = mix(u_bg * 0.6, u_bg, uv.y);\\n  vec2 q = p * u_scale + u_seed * 0.13;\\n  float w = loopFbm(q * 1.5, t, 0.6, 4.0);\\n  float ink = loopFbm(q + vec2(w, -w) * u_swirl, t, 0.8, 5.0);\\n  col = mix(col, u_ink, smoothstep(0.05, 0.45, ink) * 0.85);\\n  vec3 L = normalize(vec3(-0.4, 0.6, 0.7));\\n  float aa = 1.5 / uRes.y;\\n  for (int i = 0; i < 8; i++) {\\n    if (float(i) >= u_drops) break;\\n    float fi = float(i);\\n    vec2 c = (vec2(hash11(fi + u_seed), hash11(fi * 7.3 + u_seed)) - 0.5) * 0.7 + 0.04 * vec2(cos(TAU * t + fi), sin(TAU * t * 2.0 + fi));\\n    float r = 0.05 + 0.06 * hash11(fi * 3.1 + u_seed);\\n    float d = sdCircle(p - c, r);\\n    vec2 n2 = clamp((p - c) / r, -1.0, 1.0);\\n    vec3 n = normalize(vec3(n2, sqrt(max(0.0, 1.0 - dot(n2, n2)))));\\n    float diff = clamp(dot(n, L), 0.0, 1.0);\\n    float spec = pow(clamp(dot(reflect(vec3(0.0, 0.0, -1.0), n), L), 0.0, 1.0), 40.0);\\n    float fres = pow(1.0 - n.z, 3.0);\\n    vec3 drop = u_ink * (0.35 + 0.65 * diff) + fres * 0.4 + spec;\\n    col = mix(col, drop, 1.0 - smoothstep(-aa, aa, d));\\n  }\\n  return col;\\n}"
}`;

  // Der sichtbare, editierbare Auftrag (ohne Bild – das Bild wird angehängt)
  function text({ wishes, format }) {
    const f = format ? `${format.w} × ${format.h} px (${format.w >= format.h ? 'Querformat' : 'Hochformat'}, Seitenverhältnis ${(format.w / format.h).toFixed(3)})` : 'beliebig';
    return `Here is a reference image. Recreate it as a living, procedural GLSL fragment shader for my app – as close to the image as possible in subject, composition, shapes, colors, materials, light and fine detail.

My wish: ${wishes && wishes.trim() ? wishes.trim() : '(none – a calm, fitting animation)'}
Format: ${f}. The composition must adapt to any width/height.

Answer as JSON:
- "title": a short German name
- "notes": FIRST describe precisely what you see – the shapes and how they connect, positions as fractions of the image, colors as hex, materials (transparency, gloss, refraction, texture), light and depth. THEN your plan: techniques (signed distance fields, smooth union, noise), layers from back to front, motion.
- "params": the controls you think make sense (6–14), labels in German, e.g. {"id": "count", "label": "Anzahl", "type": "range", "min": 1, "max": 12, "step": 1, "default": 6, "group": "Form"}.
  Types: "range" (min, max, step, default), "color" (default "#rrggbb"), "select" (options, default), "toggle" (default true/false), and exactly one {"id": "seed", "label": "Seed", "type": "seed", "default": 7}. group: "Form", "Struktur" or "Bewegung".
- "shader": GLSL ES 3.0 code defining  vec3 image(vec2 uv, vec2 p, float t)  plus your own helper functions above it.

Shader rules:
- uv: 0..1 across the image (origin bottom-left). p: centered and aspect-correct (the shorter side spans -0.5..0.5). t: loop time 0..1. uRes: resolution in pixels.
- Every param is a uniform named u_<id>: float for range/seed/toggle (0 or 1)/select (option index), vec3 (0..1) for color. Do not declare them.
- The animation must loop seamlessly: only periodic functions of TAU*t with integer factors, or loopNoise(x, t, r) / loopFbm(x, t, r, octaves).
- Helpers already defined (do not redefine): TAU, snoise(vec4) simplex -1..1, fbm(vec2 x, vec2 z, float octaves), loopNoise(vec2 x, float t, float r), loopFbm(vec2 x, float t, float r, float octaves), hash12(vec2), hash11(float), smin(float a, float b, float k) smooth union, rot(float angle) mat2, sdCircle(vec2 p, float r), sdSegment(vec2 p, vec2 a, vec2 b).
- Loops only with a constant upper bound, at most 64: for (int i = 0; i < 24; i++) { if (float(i) >= u_count) break; … }. No while, no textures, no main(), no #version. It runs per pixel in 4K – keep it efficient.
- Quality: build shapes with signed distance fields and merge organic forms with smin; shade them like real materials (normal from the SDF gradient or a sphere normal, diffuse + sharp specular highlight, fresnel rim, subsurface glow, transparency via mix); anti-alias edges with smoothstep over about 1.5/uRes.y; add fine detail and texture with fbm. Keep it crisp where the reference is crisp.

Example answer (different subject – shows format and technique only):
${EXAMPLE}`;
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
