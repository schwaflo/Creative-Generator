'use strict';
/* KI: Ablauf – ein Gespräch mit einem Modell, das Bilder lesen kann.
   1. Bild + Wunsch + Regeln -> Modell beschreibt, plant, legt Regler fest, schreibt den Shader (eine JSON-Antwort)
   2. Prüfung in der Sandbox (kompilieren, Probe-Render); Fehler gehen ins selbe Gespräch zurück
   3. Runden: Das Modell sieht sein Ergebnis neben der Referenz, vergleicht selbst und verbessert
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
    const c = cfg(), model = c.model;
    if (!reference) throw fail('input', 'Bitte zuerst ein Referenzbild wählen.');
    if (known(model) && !supportsVision(model)) throw fail('model', `„${model}“ kann keine Bilder lesen. Bitte ein Modell mit Bildverständnis wählen (z. B. gemma4).`);
    await C().ensureOnly(model);
    const base = CG.ai.prompt.messages(text, reference);
    const box = new CG.ai.Sandbox({ timeout: c.timeouts.renderMs });
    let messages = base, best = null, repairs = 0, title = '', fixing = false, softTries = 0;
    const rounds = 1 + Math.max(0, c.refineRounds | 0);
    let fixesLeft = Math.max(1, c.repairAttempts | 0) + rounds;
    try {
      for (let round = 0; round < rounds; ) {
        onEvent({ type: 'ask', round, rounds, fixing });
        const d = deadline(signal, c.timeouts.generationSec, 'Generator');
        let res;
        try {
          res = await C().chat({
            model, messages, schema: CG.ai.schema.SHADER, schemaName: 'shader_generator',
            // Reparatur: mehr Variation, sonst kommt fast dieselbe Antwort zurück
            temperature: fixing ? Math.max(0.6, c.temperature) : c.temperature,
            numCtx: c.numCtx, maxTokens: c.maxTokens, think: thinkOpt(model), noThink: !c.think, keepAlive: '10m',
          }, { signal: d.signal, onChunk: (t, n) => onEvent({ type: 'tokens', n }) });
        } finally { d.done(); }
        const j = CG.ai.parse.extractJson(res.text) || {};
        const answer = {
          title: String(j.title || title || '').slice(0, 60),
          notes: String(j.notes || '').slice(0, 4000),
          params: Array.isArray(j.params) ? j.params : [],
          shader: CG.ai.parse.extractShader(j.shader != null ? String(j.shader) : res.text) || '',
        };
        if (answer.title) title = answer.title;
        onEvent({ type: 'notes', round, notes: answer.notes, title: answer.title });
        const v = await CG.ai.validate.runShader(answer.params, answer.shader, { sandbox: box, aspect, renderMs: c.timeouts.renderMs,
          onStep: step => onEvent({ type: 'step', step }) });
        if (!v.ok && v.soft && softTries++ >= 1) {         // Regler ohne Wirkung: einmal reparieren lassen, dann mit Hinweis übernehmen
          v.ok = true; v.warnings = [...v.warnings, ...v.errors]; v.errors = [];
        }
        if (!v.ok) {
          onEvent({ type: 'failed', round, errors: v.errors });
          if (--fixesLeft < 0) break;
          repairs++; fixing = true;
          messages = CG.ai.prompt.feedback(base, answer, { errors: v.errors });
          continue;                                       // gleiche Runde, nur reparieren
        }
        best = { code: answer.shader, params: v.params, warnings: v.warnings };
        fixing = false;
        onEvent({ type: 'ok', round, warnings: v.warnings });
        round++;
        if (round >= rounds) break;
        // eigenes Ergebnis neben der Referenz zeigen – das Modell vergleicht selbst
        const compare = await compareImage(box, best, aspect, reference);
        onEvent({ type: 'look', round });
        messages = CG.ai.prompt.feedback(base, { ...answer, params: v.params }, { compareBase64: compare, warnings: v.warnings });
      }
      if (!best) { const e = fail('invalid', 'Der Shader hat die Prüfung nicht bestanden.'); e.errors = ['Details stehen im Protokoll oben.']; throw e; }
      const thumb = await thumbnail(box, best, aspect);
      return { ...best, repairs, thumb, title };
    } finally {
      box.destroy();
      await C().unload(model);
    }
  }

  async function renderBitmap(box, gen, aspect, h, t = 0.25) {
    const SH = CG.ai.shader;
    const w = Math.round(h * aspect);
    const values = {}; gen.params.forEach(p => { values[p.id] = p.default; });
    const r = await box.shader({ frag: SH.source(gen.params, gen.code), uniforms: SH.uniforms(gen.params, values), t, w, h });
    return { bitmap: r.bitmap, w, h };
  }

  // Vergleichsbild: links Referenz, rechts aktuelles Ergebnis, beide beschriftet (Base64-JPEG)
  async function compareImage(box, gen, aspect, reference) {
    const h = 448;
    const out = await renderBitmap(box, gen, aspect, h);
    const ref = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + reference)).blob());
    const rw = Math.round(h * ref.width / ref.height), gap = 16;
    const cv = document.createElement('canvas'); cv.width = rw + gap + out.w; cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, h);
    g.drawImage(ref, 0, 0, rw, h); g.drawImage(out.bitmap, rw + gap, 0, out.w, h);
    ref.close(); out.bitmap.close();
    const label = (txt, x) => { g.font = 'bold 22px sans-serif'; const tw = g.measureText(txt).width; g.fillStyle = '#e8505b'; g.fillRect(x + 8, 8, tw + 16, 32); g.fillStyle = '#ffffff'; g.fillText(txt, x + 16, 32); };
    label('REFERENZ', 0); label('ERGEBNIS', rw + gap);
    const url = cv.toDataURL('image/jpeg', 0.88); cv.width = cv.height = 0;
    return url.split(',')[1];
  }

  async function thumbnail(box, gen, aspect) {
    try {
      const out = await renderBitmap(box, gen, aspect, Math.round(480 / Math.max(aspect, 1)));
      const c = document.createElement('canvas'); c.width = out.w; c.height = out.h;
      c.getContext('2d').drawImage(out.bitmap, 0, 0); out.bitmap.close();
      const url = c.toDataURL('image/png'); c.width = c.height = 0;
      return url;
    } catch (e) { return null; }
  }

  /* Im Browser speichern + als Funktion registrieren */
  async function save({ name, code, params, prompt, repairs, thumb, aspect }) {
    const c = cfg();
    const gen = await CG.ai.store.create({ kind: 'shader', name, code, params, prompt, repairs, thumb, aspect,
      models: { server: CG.ai.settings.server().label, model: c.model }, templateVersion: CG.ai.prompt.VERSION });
    return CG.ai.registry.register(gen);
  }

  return { setModels, prepareImage, generate, save, supportsVision: m => supportsVision(m) };
})();
