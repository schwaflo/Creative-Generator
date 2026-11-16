'use strict';
/* KI: Ablauf – das Modell ist Art Director (js/ai/recipe.js).
   1. Bild + Wunsch -> Modell beschreibt das Bild als Rezept aus Ebenen (eine JSON-Antwort, kein Code)
   2. Die App baut daraus den Shader und gleicht Zahlen und Farben automatisch an die Referenz an (ohne Modell)
   3. Runden: Das Modell sieht das Ergebnis neben der Referenz und ändert das Rezept; es zählt die gemessene Übereinstimmung
   Speicher (Ollama): nur dieses eine Modell ist geladen und wird am Ende entladen. */
CG.ai = CG.ai || {};
CG.ai.pipeline = (() => {
  const C = () => CG.ai.client;
  const cfg = () => CG.ai.config;
  const fail = (code, msg, detail) => new CG.ai.client.AiError(code, msg, detail);
  let caps = {};                                      // Modell -> Fähigkeiten (nur bei Ollama bekannt)

  function setModels(models) { caps = {}; (models || []).forEach(m => { caps[m.name] = m.capabilities; }); }
  const known = m => Array.isArray(caps[m]);
  const supportsThink = m => known(m) && caps[m].includes('thinking');
  const supportsVision = m => known(m) && caps[m].includes('vision');
  // Denkmodus: gpt-oss kennt nur Stufen (low/medium/high) – mit false liefert es leere Antworten
  const thinkOpt = m => !supportsThink(m) ? undefined : /gpt-oss/i.test(m) ? (cfg().think ? 'medium' : 'low') : !!cfg().think;

  // Abbruch durch Nutzer oder Zeitlimit
  function deadline(signal, sec, what) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(fail('timeout', `${what}: Zeitüberschreitung nach ${sec} s.`)), sec * 1000);
    const onAbort = () => ac.abort(signal.reason || new DOMException('Abgebrochen', 'AbortError'));
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    return { signal: ac.signal, done: () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); } };
  }

  /* Bild verkleinern (längste Seite ≤ maxImageSide) und als Base64-JPEG liefern */
  async function prepareImage(file, maxSide) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);                       // Transparenz -> weiß
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const url = c.toDataURL('image/jpeg', 0.9);
    c.width = c.height = 0;
    return { base64: url.split(',')[1], dataUrl: url, w, h };
  }

  async function generate(text, { signal, aspect = 16 / 9, onEvent = () => {}, reference = null } = {}) {
    const c = cfg(), model = c.model, RC = CG.ai.recipe;
    if (!reference) throw fail('input', 'Bitte zuerst ein Referenzbild wählen.');
    if (known(model) && !supportsVision(model)) throw fail('model', `„${model}“ kann keine Bilder lesen. Bitte ein Modell mit Bildverständnis wählen (z. B. gemma4).`);
    await C().ensureOnly(model);
    const base = CG.ai.prompt.messages(text, reference);
    const ref = await RC.referenceFeatures(reference, aspect);
    const rd = new RC.Renderer();
    let messages = base, best = null;
    const all = [];                                       // Fassungen aller Runden (zur Auswahl)
    const rounds = 1 + Math.max(0, c.refineRounds | 0);
    try {
      for (let round = 0; round < rounds; round++) {
        onEvent({ type: 'ask', round, rounds });
        const d = deadline(signal, c.timeouts.generationSec, 'Generator');
        let res;
        try {
          res = await C().chat({
            model, messages, schema: RC.SCHEMA, schemaName: 'recipe', temperature: c.temperature,
            numCtx: c.numCtx, maxTokens: c.maxTokens, think: thinkOpt(model), noThink: !c.think, keepAlive: '10m',
          }, { signal: d.signal, onChunk: (t, n) => onEvent({ type: 'tokens', n }) });
        } finally { d.done(); }
        const raw = CG.ai.parse.extractJson(res.text);
        if (!raw && !best) throw fail('invalid', 'Das Modell hat kein lesbares Rezept geliefert. Bitte nochmal versuchen.');
        if (!raw) break;                                    // spätere Runde unlesbar: bisheriges Ergebnis bleibt
        let recipe = RC.normalize(raw);
        onEvent({ type: 'recipe', round, notes: recipe.notes, title: recipe.title, layers: RC.describe(recipe) });
        // Shader aus Bausteinen der App, dann automatisch angleichen
        let params0 = CG.ai.schema.validateParams(RC.toParams(recipe)).params, code = RC.toCode(recipe);
        rd.compile(params0, code);
        const progress = p => onEvent({ type: 'fit', round, done: p.done, steps: p.steps, from: RC.similarity(p.start), to: RC.similarity(p.best) });
        let fitted = await RC.fit(rd, params0, ref, { steps: c.fitSteps, signal, onProgress: progress });
        // Ebenen, ohne die das Bild mindestens so gut passt, fliegen raus – danach neu angleichen
        const drop = RC.prune(rd, fitted.params, ref);
        if (drop.length) {
          const first = fitted.start;
          onEvent({ type: 'pruned', round, layers: drop.map(i => RC.TYPES[recipe.layers[i].type].label) });
          recipe = RC.withParams(recipe, fitted.params);
          recipe.layers = recipe.layers.filter((L, i) => !drop.includes(i));
          params0 = CG.ai.schema.validateParams(RC.toParams(recipe)).params; code = RC.toCode(recipe);
          rd.compile(params0, code);
          fitted = await RC.fit(rd, params0, ref, { steps: Math.round(c.fitSteps * 0.6), signal, onProgress: progress });
          fitted.start = first;
        }
        const cand = { code, params: fitted.params, recipe: RC.withParams(recipe, fitted.params), score: fitted.best, title: recipe.title, round };
        rd.compile(cand.params, cand.code);
        cand.thumb = snapshot(rd, aspect, Math.round(480 / Math.max(aspect, 1)), 'image/png');
        cand.similarity = RC.similarity(cand.score);
        all.push(cand);
        // eine spätere Runde ersetzt die frühere nur, wenn sie messbar besser ist (kleine Unterschiede sind Rauschen)
        const better = !best || cand.score < best.score * 0.97;
        onEvent({ type: 'fitted', round, from: RC.similarity(fitted.start), to: RC.similarity(fitted.best), kept: better });
        if (better) best = cand;
        if (round + 1 >= rounds) break;
        // bestes Ergebnis neben der Referenz zeigen – das Modell ändert das Rezept
        rd.compile(best.params, best.code);
        const compare = await compareImage(rd, aspect, reference);
        onEvent({ type: 'look', round });
        messages = CG.ai.prompt.feedback(base, { title: best.recipe.title, notes: best.recipe.notes, ...best.recipe }, { compareBase64: compare });
      }
      return { ...best, candidates: all, repairs: 0, warnings: [] };
    } finally {
      rd.destroy();
      await C().unload(model);
    }
  }

  // aktuelles Programm des Renderers als Bild (Data-URL)
  function snapshot(rd, aspect, h, mime, quality) {
    const w = Math.max(8, Math.round(h * aspect));
    return rd.render(w, h, 0.25).toDataURL(mime, quality);
  }

  // Vergleichsbild: links Referenz, rechts aktuelles Ergebnis, beide beschriftet (Base64-JPEG)
  async function compareImage(rd, aspect, reference) {
    const h = 448, w = Math.max(8, Math.round(h * aspect));
    const out = rd.render(w, h, 0.25);
    const ref = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + reference)).blob());
    const rw = Math.round(h * ref.width / ref.height), gap = 16;
    const cv = document.createElement('canvas'); cv.width = rw + gap + w; cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, h);
    g.drawImage(ref, 0, 0, rw, h); g.drawImage(out, rw + gap, 0, w, h);
    ref.close();
    const label = (txt, x) => { g.font = 'bold 22px sans-serif'; const tw = g.measureText(txt).width; g.fillStyle = '#e8505b'; g.fillRect(x + 8, 8, tw + 16, 32); g.fillStyle = '#ffffff'; g.fillText(txt, x + 16, 32); };
    label('REFERENZ', 0); label('ERGEBNIS', rw + gap);
    const url = cv.toDataURL('image/jpeg', 0.88); cv.width = cv.height = 0;
    return url.split(',')[1];
  }

  /* Im Browser speichern + als Funktion registrieren (ein normaler Shader-Generator mit Rezept) */
  async function save({ name, code, params, recipe, score, prompt, thumb, aspect }) {
    const c = cfg();
    const gen = await CG.ai.store.create({ kind: 'shader', name, code, params, recipe, score, prompt, repairs: 0, thumb, aspect,
      models: { server: CG.ai.settings.server().label, model: c.model }, templateVersion: CG.ai.prompt.VERSION });
    return CG.ai.registry.register(gen);
  }

  return { setModels, prepareImage, generate, save, supportsVision: m => supportsVision(m) };
})();
