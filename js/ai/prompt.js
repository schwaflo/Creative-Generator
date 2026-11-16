'use strict';
/* KI: Prompt – das Modell ist Art Director. Es schreibt keinen Code, sondern beschreibt das Bild als Rezept
   aus Ebenen (js/ai/recipe.js). Zahlen und Farben gleicht die App danach selbst an die Referenz an.
   Bei Änderungen am Auftrag: VERSION erhöhen (wird mit jedem Generator gespeichert). */
CG.ai = CG.ai || {};
CG.ai.prompt = (() => {
  const VERSION = 'rezept-v1';

  const SYSTEM = 'You are an art director for generative design. You look at reference images very carefully and describe them as a recipe of layers for a procedural renderer. You never write code. You always answer with one JSON object.';

  // Der sichtbare, editierbare Auftrag (ohne Bild – das Bild wird angehängt)
  function text({ wishes, format } = {}) {
    const f = format ? `${format.w} × ${format.h} px (${format.w >= format.h ? 'landscape' : 'portrait'})` : 'any';
    return `Here is a reference image. Describe it as a recipe of layers for my procedural renderer, so that the rendering looks as close to the image as possible. You do not write code – you choose layers and set values. My app fine-tunes all numbers and colors automatically afterwards, so the choice and the order of the layers matter most.

My wish: ${wishes && wishes.trim() ? wishes.trim() : '(none)'}
Format: ${f}

Answer as JSON:
- "title": a short German name
- "notes": what you see – the main structure, what lies in front and behind, colors (hex), light, depth and blur. Then which layers you choose and why.
- "background": "top" and "bottom" (hex colors of the backdrop), "glow" (hex color of the brightest light area), "glowX"/"glowY" (its position 0..1, x from the left, y from the top), "glowSize" 0..1, "glowStrength" 0..1
- "camera": "tilt" 0..1 (0 = flat frontal view, 0.4 = clearly tilted, 0.8 = a surface seen at a very steep angle, receding into the distance), "roll" -180..180 (degrees the scene is rotated), "zoom" 0..1 (0.5 = normal), "focus" 0..1 (which depth is sharp: 0 = near, 1 = far), "blur" 0..1 (strength of the depth of field), "haze" 0..1 (the distance fades into the glow color)
- "light": "angle" 0..360 (where the light comes from: 0 = right, 90 = top)
- "layers": 1 to 5 layers, from back to front – as few as the image needs (often 1 to 3); every layer must stand for something you really see. Empty areas and holes are not layers: the backdrop shows through them. Each has "type", "colorA" (main, lit color), "colorB" (shadow or second color) and values 0..1:
  "size" (size of the elements; 0.5 ≈ four across the image), "fill" (thickness / coverage; 0.2 = thin and airy, 0.5 = medium, 0.8 = massive), "chaos" (0 = regular, 1 = irregular and organic), "detail" (fine grainy surface texture), "relief" (3D shading), "gloss" (shiny highlights), "glass" (transparent centers), "soft" (blurred edges), "opacity";
  also "angle" 0..360, "blend" (normal | add | multiply | screen), "motion" (still | flow | drift | pulse), "move" 0..1 (strength of the motion), "speed" 1..3.

Layer types:
- mesh: organic net / web / foam / honeycomb – strands around holes (fill = strand thickness)
- cells: packed cells / pebbles / scales / tiles with gaps (fill = how tightly packed)
- blobs: soft merging drops / bubbles / spheres (fill = blob size)
- dots: separate crisp dots / halftone / particles as a motif of their own (chaos 0 = regular grid). A grainy, stippled or porous surface is NOT a dots layer – use "detail" of the layer it belongs to.
- fibers: flowing strands / hair / threads / brush strokes (fill = thickness)
- contours: curved contour lines like a height map
- stripes: straight parallel bands (chaos = waviness)
- rings: concentric rings around the center
- fog: soft clouds / smoke / mist (fill = coverage)
- fluid: marbled liquid / ink swirls covering everything (colorA and colorB mix)
- facets: crystal shards / low-poly mosaic covering everything
- bokeh: blurred light spots / glowing particles`;
  }

  function messages(promptText, imageBase64) {
    const user = { role: 'user', content: promptText };
    if (imageBase64) user.images = [imageBase64];
    return [{ role: 'system', content: SYSTEM }, user];
  }

  // Nächste Runde im selben Gespräch: Das Modell sieht das (bereits angeglichene) Ergebnis neben der Referenz
  function feedback(history, recipe, { compareBase64 }) {
    const next = { role: 'user', content: `Attached: LEFT = the reference, RIGHT = what your recipe renders (numbers and colors already fine-tuned by the app – they are written into your recipe above).
Compare them as a demanding art director: which structure is still missing or wrong? Would another layer type, another order, an additional or a removed layer, a different camera tilt or blur bring it closer?
Write that into "notes", then answer with the full improved JSON recipe. Keep what already fits.` };
    if (compareBase64) next.images = [compareBase64];
    return [...history, { role: 'assistant', content: JSON.stringify(recipe, null, 1) }, next];
  }

  return { VERSION, SYSTEM, text, messages, feedback };
})();
