'use strict';
/* KI: Ablauf Bild -> Analyse -> Prompt -> Code -> Prüfung/Reparatur -> Speichern.
   Jeder Schritt ist eine Anfrage mit erzwungenem Antwortformat (JSON-Schema).
   Speicher-Regel (Ollama): immer nur ein Modell geladen – Vision wird vor dem Code-Modell entladen. */
CG.ai = CG.ai || {};
CG.ai.pipeline = (() => {
  const C = () => CG.ai.client;
  const cfg = () => CG.ai.config;
  const fail = (code, msg, detail) => new CG.ai.client.AiError(code, msg, detail);
  let caps = {};                                      // Modell -> Fähigkeiten (nur Ollama bekannt)

  function setModels(models) { caps = {}; (models || []).forEach(m => { caps[m.name] = m.capabilities; }); }
  const supportsThink = m => Array.isArray(caps[m]) && caps[m].includes('thinking');
  const supportsVision = m => Array.isArray(caps[m]) && caps[m].includes('vision');
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

  /* 1. Bildanalyse (strukturiertes JSON) */
  async function analyze(imageBase64, { signal, onTokens } = {}) {
    const c = cfg(), model = c.visionModel;
    await C().ensureOnly(model);
    const same = model === c.codeModel;
    const d = deadline(signal, c.timeouts.analysisSec, 'Bildanalyse');
    try {
      const res = await C().chat({
        model, messages: CG.ai.prompt.analysisMessages(imageBase64),
        schema: CG.ai.schema.ANALYSIS, schemaName: 'bildanalyse',
        temperature: c.temperature.vision, numCtx: c.numCtx.vision, think: thinkOpt(model), noThink: !c.think,
        keepAlive: same ? '10m' : 0,                       // anderes Code-Modell -> Vision sofort entladen
      }, { signal: d.signal, onChunk: (t, n) => onTokens && onTokens(n) });
      const json = CG.ai.parse.extractJson(res.text);
      if (!json) throw fail('parse', 'Die Bildanalyse lieferte kein gültiges JSON. Bitte erneut versuchen.', res.text);
      return CG.ai.schema.cleanAnalysis(json);
    } finally {
      d.done();
      if (!same) await C().unload(model);
    }
  }

  /* 2.–4. Code erzeugen, prüfen, bei Fehlern reparieren lassen */
  async function generate(promptText, { signal, aspect = 16 / 9, onEvent = () => {}, reference = null, analysis = null } = {}) {
    const c = cfg(), model = c.codeModel;
    onEvent({ type: 'models' });
    await C().ensureOnly(model);
    // Kann das Code-Modell Bilder lesen, sieht es die Referenz direkt
    const base = CG.ai.prompt.messages(promptText, reference && supportsVision(model) ? reference : null);
    let messages = base, lastErrors = [], lastCode = null;
    const box = new CG.ai.Sandbox({ timeout: c.timeouts.renderMs });
    const tries = 1 + Math.max(0, c.repairAttempts | 0);
    try {
      for (let attempt = 0; attempt < tries; attempt++) {
        onEvent({ type: 'request', attempt, tries });
        const d = deadline(signal, c.timeouts.generationSec, 'Code-Generierung');
        let res;
        try {
          res = await C().chat({
            model, messages, schema: CG.ai.schema.CODE, schemaName: 'generator',
            temperature: attempt ? c.temperature.repair : c.temperature.code, numCtx: c.numCtx.code,
            think: thinkOpt(model), noThink: !c.think, keepAlive: '10m',
          }, { signal: d.signal, onChunk: (t, n) => onEvent({ type: 'tokens', attempt, n }) });
        } finally { d.done(); }
        const code = CG.ai.parse.extractGenerated(res.text);
        let errors;
        if (!code) errors = ['Die Antwort enthielt keinen Code. Antworte ausschließlich mit {"code": "<vollständige JavaScript-Datei>"}.'];
        else {
          lastCode = code;
          onEvent({ type: 'validate', attempt });
          const v = await CG.ai.validate.run(code, { sandbox: box, aspect, renderMs: c.timeouts.renderMs,
            onStep: step => onEvent({ type: 'step', attempt, step }) });
          if (v.ok) {
            onEvent({ type: 'ok', attempt, warnings: v.warnings });
            let best = { code, params: v.params, warnings: v.warnings };
            if (reference && c.refineRounds > 0) best = await improve(best, { base, box, aspect, reference, analysis, signal, onEvent });
            const thumb = await thumbnail(box, best.params, aspect, best.code);
            return { ...best, repairs: attempt, thumb };
          }
          errors = v.errors;
        }
        lastErrors = errors;
        onEvent({ type: 'failed', attempt, errors, last: attempt === tries - 1 });
        messages = CG.ai.prompt.repair(base, code || res.text.slice(0, 6000), errors);
      }
      const err = fail('invalid', `Der Generator funktioniert nach ${tries - 1} Reparaturversuchen noch nicht.`);
      err.errors = lastErrors; err.lastCode = lastCode;
      throw err;
    } finally {
      box.destroy();
      await C().unload(model);                          // Speicher wieder freigeben
    }
  }

  /* 5. Bildvergleich: Vision-Modell vergleicht ein gerendertes Bild mit der Referenz,
        das Code-Modell überarbeitet. Behalten wird nur, was die Prüfung besteht und besser bewertet ist. */
  async function improve(best, { base, box, aspect, reference, analysis, signal, onEvent }) {
    const c = cfg();
    const sameModel = c.visionModel === c.codeModel;
    let score = null;
    for (let round = 1; round <= c.refineRounds; round++) {
      onEvent({ type: 'review', round });
      const { review, compare } = await critique(best, { box, aspect, reference, analysis, signal });
      if (score === null) score = review.score;
      onEvent({ type: 'reviewed', round, review });
      if (review.score >= 8 || !review.improvements.length) break;
      onEvent({ type: 'refine', round });
      if (!sameModel) await C().ensureOnly(c.codeModel);
      // Überarbeiten; scheitert die Prüfung, bis zu 2× reparieren statt verwerfen
      let msgs = CG.ai.prompt.refine(base, best.code, review, supportsVision(c.codeModel) ? compare : null);
      let code = null, v = { ok: false, errors: ['kein Code'] };
      for (let fix = 0; fix < 3 && !v.ok; fix++) {
        const d = deadline(signal, c.timeouts.generationSec, 'Überarbeitung');
        let res;
        try {
          res = await C().chat({
            model: c.codeModel, messages: msgs, schema: CG.ai.schema.CODE, schemaName: 'generator',
            temperature: fix ? c.temperature.repair : c.temperature.code, numCtx: c.numCtx.code, think: thinkOpt(c.codeModel), noThink: !c.think, keepAlive: '10m',
          }, { signal: d.signal, onChunk: (t, n) => onEvent({ type: 'tokens', n }) });
        } finally { d.done(); }
        code = CG.ai.parse.extractGenerated(res.text);
        v = code ? await CG.ai.validate.run(code, { sandbox: box, aspect, renderMs: c.timeouts.renderMs }) : { ok: false, errors: ['Die Antwort enthielt keinen Code.'] };
        if (!v.ok) { onEvent({ type: 'refine-fix', round, errors: v.errors }); msgs = CG.ai.prompt.repair(base, code || res.text.slice(0, 6000), v.errors); }   // neue Fassung nur noch reparieren
      }
      if (!v.ok) { onEvent({ type: 'refined', round, ok: false, errors: v.errors }); await box.load(best.code); continue; }
      const cand = { code, params: v.params, warnings: v.warnings };
      // neue Fassung erneut bewerten – nur übernehmen, wenn sie mindestens gleich gut ist
      const check = (await critique(cand, { box, aspect, reference, analysis, signal })).review;
      const better = check.score >= score;
      onEvent({ type: 'refined', round, ok: true, better, before: score, after: check.score });
      if (better) { best = cand; score = check.score; } else await box.load(best.code);
    }
    return { ...best, score };
  }

  async function critique(gen, { box, aspect, reference, analysis, signal }) {
    const c = cfg();
    await C().ensureOnly(c.visionModel);
    const compare = await compareImage(box, gen, aspect, reference);
    const d = deadline(signal, c.timeouts.analysisSec, 'Bildvergleich');
    try {
      const res = await C().chat({
        model: c.visionModel, messages: CG.ai.prompt.reviewMessages(compare, analysis), schema: CG.ai.schema.REVIEW, schemaName: 'bildvergleich',
        temperature: c.temperature.vision, numCtx: c.numCtx.vision, think: thinkOpt(c.visionModel), noThink: !c.think,
        keepAlive: c.visionModel === c.codeModel ? '10m' : 0,
      }, { signal: d.signal });
      const j = CG.ai.parse.extractJson(res.text) || {};
      const arr = x => Array.isArray(x) ? x.map(String).filter(Boolean).slice(0, 8) : [];
      return { compare, review: { score: Math.max(1, Math.min(10, Math.round(+j.score) || 1)), matches: arr(j.matches), problems: arr(j.problems), improvements: arr(j.improvements) } };
    } finally {
      d.done();
      if (c.visionModel !== c.codeModel) await C().unload(c.visionModel);
    }
  }

  // Vergleichsbild: links Referenz, rechts aktuelles Einzelbild, beide beschriftet (Base64-JPEG)
  async function compareImage(box, gen, aspect, reference) {
    await box.ensure(gen.code);
    const vals = {}; gen.params.forEach(p => { vals[p.id] = p.default; });
    const h = 448, w = Math.round(h * aspect);
    const r = await box.render({ values: vals, t: 0.25, w, h, seed: Math.round(+(vals.seed ?? 1)) || 1 });
    const ref = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + reference)).blob());
    const rw = Math.round(h * ref.width / ref.height), gap = 16;
    const cv = document.createElement('canvas'); cv.width = rw + gap + w; cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, h);
    g.drawImage(ref, 0, 0, rw, h); g.drawImage(r.bitmap, rw + gap, 0, w, h);
    ref.close(); r.bitmap.close();
    const label = (txt, x) => { g.font = 'bold 22px sans-serif'; const tw = g.measureText(txt).width; g.fillStyle = '#e8505b'; g.fillRect(x + 8, 8, tw + 16, 32); g.fillStyle = '#ffffff'; g.fillText(txt, x + 16, 32); };
    label('REFERENZ', 0); label('ERGEBNIS', rw + gap);
    const url = cv.toDataURL('image/jpeg', 0.88); cv.width = cv.height = 0;
    return url.split(',')[1];
  }

  async function thumbnail(box, params, aspect, code) {
    const vals = {}; params.forEach(p => { vals[p.id] = p.default; });
    const w = 480, h = Math.round(480 / aspect);
    try {
      if (code) await box.ensure(code);
      const r = await box.render({ values: vals, t: 0.25, w, h, seed: Math.round(+(vals.seed ?? 1)) || 1 });
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(r.bitmap, 0, 0); r.bitmap.close();
      const url = c.toDataURL('image/png'); c.width = c.height = 0;
      return url;
    } catch (e) { return null; }
  }

  /* Im Browser speichern + als Funktion registrieren */
  async function save({ name, code, params, analysis, prompt, repairs, thumb, aspect }) {
    const c = cfg();
    const gen = await CG.ai.store.create({ name, code, params, analysis, prompt, repairs, thumb, aspect,
      models: { server: CG.ai.settings.server().label, vision: c.visionModel, code: c.codeModel }, templateVersion: CG.ai.prompt.VERSION });
    return CG.ai.registry.register(gen);
  }

  return { setModels, prepareImage, analyze, generate, save };
})();
